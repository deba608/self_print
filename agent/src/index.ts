import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";
import sharp from "sharp";
import { PDFiumLibrary } from "@hyzyla/pdfium";

type AgentConfig = {
  supabaseUrl: string;
  supabaseKey: string;
  tempDir: string;
  maxRetries: number;
  fallbackPrinter: string;
};

type SupabaseJob = {
  id: string;
  token: string;
  status: string;
  print_type: string;
  copies: number;
  page_range: string | null;
  paper_size: string;
  layout: string;
  pages_per_sheet: number;
  margins: string;
  scale: string;
  duplex: string;
  page_count: number;
  price_paise: number;
  needs_conversion: number;
  queue_position: number;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  printed_at: string | null;
};

type SupabaseJobFile = {
  id: string;
  job_id: string;
  original_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  file_kind: string;
  storage_path: string;
  created_at: string;
};

type WindowsPrinter = {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
};

let config: AgentConfig;
let supabase: ReturnType<typeof createClient>;
let realtimeChannel: RealtimeChannel | null = null;
let isShuttingDown = false;
let isProcessing = false;
let cachedPrinterName = "";
let lastPrinterReportAt = 0;
let reconnectAttempts = 0;
let intervalsStarted = false;
const MAX_RECONNECT_DELAY = 30000;
const PRINTER_REPORT_INTERVAL = 60000;
const POLL_INTERVAL = 5000;

async function main() {
  config = await loadConfig();
  supabase = createClient(config.supabaseUrl, config.supabaseKey);

  cachedPrinterName = config.fallbackPrinter;
  await fs.mkdir(config.tempDir, { recursive: true });

  log("=== SelfPrint Agent (Supabase Realtime + Polling) ===");
  log(`Supabase: ${config.supabaseUrl}`);
  log(`Fallback printer: ${config.fallbackPrinter || "(none)"}`);

  // Crash-proofing: a transient Supabase/network error must NOT kill the agent.
  process.on("uncaughtException", (err) => {
    log(`Uncaught exception (continuing): ${err instanceof Error ? err.message : String(err)}`);
  });
  process.on("unhandledRejection", (reason) => {
    log(`Unhandled rejection (continuing): ${reason instanceof Error ? reason.message : String(reason)}`);
  });

  process.on("SIGINT", () => {
    log("Received shutdown signal, finishing current job...");
    isShuttingDown = true;
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
    }
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    log("Received terminate signal, shutting down...");
    isShuttingDown = true;
    if (realtimeChannel) {
      supabase.removeChannel(realtimeChannel);
    }
    process.exit(0);
  });

  // Load initial printer config
  await checkPrinterConfig();

  await connectRealtime();
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exitCode = 1;
});

async function connectRealtime() {
  if (isShuttingDown) return;

  try {
    log("Connecting to Supabase Realtime...");

    if (realtimeChannel) {
      await supabase.removeChannel(realtimeChannel);
    }

    realtimeChannel = supabase
      .channel("print-jobs")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "jobs"
        },
        async (payload) => {
          const newStatus = (payload.new as any)?.status;
          const jobId = (payload.new as any)?.id;
          const needsConversion = (payload.new as any)?.needs_conversion;
          log(`Realtime event: ${payload.eventType} job ${jobId} status=${newStatus}`);
          
          if (newStatus === "approved" && !needsConversion && !isProcessing && !isShuttingDown) {
            isProcessing = true; // claim synchronously before any await to prevent double-processing
            processJob(jobId).finally(() => { isProcessing = false; });
          }
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          log("Connected to Supabase Realtime — waiting for print jobs...");
          reconnectAttempts = 0;
          reportPrintersIfNeeded();
          // Recovery: pick up any approved job missed while disconnected/crashed.
          pollApprovedJobs();
          startIntervals();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          log(`Realtime connection issue: ${status}`);
          scheduleReconnect();
        }
      });
  } catch (error) {
    log(`Realtime connection failed: ${error instanceof Error ? error.message : String(error)}`);
    scheduleReconnect();
  }
}

// Start background timers exactly once (subscribe fires on every reconnect).
function startIntervals() {
  if (intervalsStarted) return;
  intervalsStarted = true;

  setInterval(() => {
    if (!isShuttingDown) reportPrintersIfNeeded();
  }, PRINTER_REPORT_INTERVAL);

  setInterval(() => {
    if (!isShuttingDown) checkPrinterConfig();
  }, 30000);

  // Polling fallback: do NOT rely on realtime delivery. Every few seconds
  // scan for approved jobs and print them. Survives realtime CHANNEL_ERROR.
  setInterval(() => {
    if (!isShuttingDown) pollApprovedJobs();
  }, POLL_INTERVAL);
}

async function pollApprovedJobs() {
  if (isProcessing || isShuttingDown) return;
  try {
    const { data, error } = await supabase
      .from("jobs")
      .select("id")
      .eq("status", "approved")
      .order("created_at", { ascending: true })
      .limit(1) as { data: { id: string }[] | null; error: { message: string } | null };

    if (error) {
      log(`Poll failed: ${error.message}`);
      return;
    }
    if (data && data.length > 0) {
      log(`Poll found approved job ${data[0].id}`);
      await processJob(data[0].id);
    }
  } catch (error) {
    log(`Poll error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function scheduleReconnect() {
  if (isShuttingDown) return;
  reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), MAX_RECONNECT_DELAY);
  log(`Reconnecting in ${delay / 1000}s (attempt ${reconnectAttempts})...`);
  setTimeout(() => connectRealtime(), delay);
}

async function processJob(jobId: string) {
  // Callers must check isProcessing before calling. isProcessing is set true
  // synchronously by the caller (Realtime handler) or here (poll path) before
  // any await, preventing concurrent execution.
  if (isShuttingDown) return;
  isProcessing = true;

  try {
    log(`Processing job ${jobId}...`);

    const { data: job, error: jobError } = await supabase
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .single() as { data: SupabaseJob | null; error: { message: string } | null };

    if (jobError || !job) {
      log(`Failed to fetch job ${jobId}: ${jobError?.message}`);
      return;
    }

    if (job.needs_conversion) {
      log(`Job ${job.token} needs conversion, skipping (will not fail — convert in admin dashboard).`);
      return;
    }

    const { data: files, error: fileError } = await supabase
      .from("job_files")
      .select("*")
      .eq("job_id", jobId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }) as { data: SupabaseJobFile[] | null; error: { message: string } | null };

    if (fileError || !files || files.length === 0) {
      await updateStatus(jobId, "failed", "No file found for this job.");
      log(`No files found for job ${jobId}`);
      return;
    }

    // Only claim this job if the selected printer is installed on THIS machine.
    // Multiple agents may share one Supabase (e.g. a dev box + the shop PC). If
    // this agent doesn't have the target printer, leave the job "approved" so the
    // correct agent picks it up — never mark it "failed" for everyone.
    const targetPrinter = cachedPrinterName || config.fallbackPrinter;
    if (targetPrinter) {
      try {
        const installed = await listWindowsPrinters();
        if (installed.length && !installed.some((p) => p.name === targetPrinter)) {
          log(`Skipping job ${job.token}: printer "${targetPrinter}" not installed here (leaving for another agent).`);
          return;
        }
      } catch (e) {
        log(`Local printer check failed, proceeding anyway: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // Atomically claim the job: flip approved -> printing only if it's still
    // approved. Postgres serializes this, so when several agents race for the
    // same job exactly one wins. Losers get 0 rows back and bail — this is what
    // stops the job being printed multiple times by parallel agents.
    if (!(await claimJob(jobId, job.token))) {
      log(`Job ${job.token} already claimed by another agent, skipping.`);
      return;
    }

    let attempt = 0;
    while (attempt < config.maxRetries) {
      attempt++;
      const tempPaths: string[] = [];
      try {
        for (let idx = 0; idx < files.length; idx++) {
          const file = files[idx];
          const extension = extensionFor(file.mime_type, file.original_name);
          const tempPath = path.resolve(
            config.tempDir,
            `${job.token}-${idx}-${safeFileName(file.original_name, extension)}`
          );
          tempPaths.push(tempPath);

          // Wrap per-file work so any failure names the offending file in the
          // job's failure message (an admin reading jobs.status can then tell
          // which of N files broke). The outer retry/catch still fires unchanged.
          try {
            log(`Downloading file ${idx + 1}/${files.length} (attempt ${attempt}/${config.maxRetries})...`);
            const fileBytes = await downloadJobFile(file);
            await fs.writeFile(tempPath, fileBytes);
            log(`File downloaded: ${fileBytes.length} bytes`);
            await logEvent(jobId, "downloaded", `Downloaded ${file.original_name} (${(fileBytes.length / 1024).toFixed(0)} KB), file ${idx + 1}/${files.length}.`);

            const printer = cachedPrinterName || config.fallbackPrinter;
            if (!printer) throw new Error("No printer selected. Set a printer in admin dashboard.");

            log(`Printing ${job.copies} copy(s), paper: ${job.paper_size}, type: ${job.print_type}, printer: ${printer}...`);
            await logEvent(jobId, "spooling", `Printing ${file.original_name} (${idx + 1}/${files.length}) on ${printer}.`);
            const PRINT_TIMEOUT_MS = 5 * 60 * 1000; // 5 min — covers PDF rasterisation + GDI spool
            await Promise.race([
              printJob(tempPath, job, printer),
              new Promise<never>((_, reject) =>
                setTimeout(() => reject(new Error("Print job timed out after 5 minutes")), PRINT_TIMEOUT_MS)
              )
            ]);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            throw new Error(`File "${file.original_name}": ${msg}`);
          }
        }

        await updateStatus(jobId, "printed", `Printed ${files.length} file(s) on attempt ${attempt}.`);
        log(`Job ${job.token} completed successfully (${files.length} file(s)).`);
        break;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(`Attempt ${attempt} failed: ${errorMsg}`);

        if (attempt >= config.maxRetries) {
          await updateStatus(jobId, "failed", `Failed after ${config.maxRetries} attempts: ${errorMsg}`);
          log(`Job ${job.token} failed permanently.`);
        } else {
          await updateStatus(jobId, "printing", `Retry ${attempt}/${config.maxRetries} after error: ${errorMsg}`);
          await sleep(2000);
        }
      } finally {
        for (const p of tempPaths) await fs.rm(p, { force: true }).catch(() => undefined);
      }
    }
  } catch (error) {
    log(`Job processing error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    isProcessing = false;
  }
}

// Download one job_files row's bytes from Supabase Storage. Uploads may store
// a relative path (originals/x.pdf) OR a full Supabase URL (public/sign/
// authenticated). In all those cases download via the service-role SDK so it
// works even though the bucket is PRIVATE (plain fetch on a private bucket's
// public URL returns 400).
async function downloadJobFile(file: SupabaseJobFile): Promise<Buffer> {
  let fileBytes: Buffer;
  const storagePath = file.storage_path;

  let objectPath: string | null = null;
  if (storagePath.startsWith("http")) {
    try {
      const url = new URL(storagePath);
      const marker = url.pathname.match(/\/object\/(?:public|sign|authenticated)\/[^/]+\/(.+)$/);
      if (marker?.[1]) objectPath = decodeURIComponent(marker[1]);
    } catch {}
  } else {
    objectPath = storagePath.replace(/^selfprint\//, "");
  }

  if (objectPath) {
    const { data: blob, error: downloadError } = await supabase.storage
      .from("selfprint")
      .download(objectPath);

    if (downloadError) throw new Error(`Storage download failed: ${downloadError.message}`);
    fileBytes = Buffer.from(await blob.arrayBuffer());
  } else {
    // Truly external URL (not a Supabase storage object).
    const response = await fetch(storagePath);
    if (!response.ok) throw new Error(`Download failed: ${response.status}`);
    fileBytes = Buffer.from(await response.arrayBuffer());
  }

  if (Number.isFinite(file.size_bytes) && file.size_bytes > 0 && fileBytes.length !== file.size_bytes) {
    log(`Warning: file size mismatch (expected ${file.size_bytes}, got ${fileBytes.length})`);
  }

  return fileBytes;
}

// Insert a progress event without touching job.status (drives the admin UI's
// live progress tracker: downloaded -> sent to printer -> printed).
async function logEvent(jobId: string, eventType: string, message: string) {
  try {
    await (supabase.from("print_events") as any).insert([{
      id: crypto.randomUUID(),
      job_id: jobId,
      event_type: eventType,
      message,
      created_at: new Date().toISOString()
    }]);
  } catch (error) {
    log(`Failed to log event ${eventType}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Atomic claim. Returns true only if THIS agent flipped the job approved->printing.
async function claimJob(jobId: string, token: string): Promise<boolean> {
  try {
    const now = new Date().toISOString();
    const { data, error } = await (supabase.from("jobs") as any)
      .update({ status: "printing", updated_at: now })
      .eq("id", jobId)
      .eq("status", "approved")
      .select("id") as { data: { id: string }[] | null; error: { message: string } | null };

    if (error) {
      log(`Claim failed for job ${token}: ${error.message}`);
      return false;
    }
    if (!data || data.length === 0) return false;

    await (supabase.from("print_events") as any).insert([{
      id: crypto.randomUUID(),
      job_id: jobId,
      event_type: "printing",
      message: "Agent claimed job, downloading file...",
      created_at: now
    }]);
    return true;
  } catch (error) {
    log(`Claim error for job ${token}: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

async function updateStatus(jobId: string, status: string, message: string) {
  try {
    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { status, updated_at: now };
    if (status === "printed") updates.printed_at = now;

    await (supabase.from("jobs") as any).update(updates).eq("id", jobId).in("status", ["approved", "printing"]);

    await (supabase.from("print_events") as any).insert([{
      id: crypto.randomUUID(),
      job_id: jobId,
      event_type: status,
      message,
      created_at: now
    }]);
  } catch (error) {
    log(`Failed to update status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function checkPrinterConfig() {
  try {
    const { data, error } = await supabase
      .from("agent_config")
      .select("printer_name")
      .eq("id", 1)
      .single() as { data: { printer_name: string } | null; error: { message: string } | null };

    if (!error && data?.printer_name) {
      cachedPrinterName = data.printer_name;
      log(`Printer config: ${cachedPrinterName}`);
    }
  } catch (error) {
    log(`Printer config check failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function reportPrintersIfNeeded() {
  const now = Date.now();
  if (now - lastPrinterReportAt < PRINTER_REPORT_INTERVAL) return;
  lastPrinterReportAt = now;

  try {
    const printers = await listWindowsPrinters();
    if (!printers.length) {
      log("No Windows printers detected.");
      return;
    }

    // Upsert (not delete-all) so multiple agents sharing this DB don't wipe each
    // other's printers — the admin then sees the union of all live machines.
    const now = new Date().toISOString();
    const rows = printers.map((printer) => ({
      name: printer.name,
      driver_name: printer.driverName,
      port_name: printer.portName,
      is_default: printer.isDefault ? 1 : 0,
      seen_at: now
    }));
    const { error: upsertError } = await (supabase.from("agent_printers") as any)
      .upsert(rows, { onConflict: "name" });
    if (upsertError) throw new Error(upsertError.message);

    // Drop printers no agent has reported for 5 min (machine offline / removed).
    const cutoff = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    await (supabase.from("agent_printers") as any).delete().lt("seen_at", cutoff);

    log(`Reported ${printers.length} printer(s) to Supabase.`);
  } catch (error) {
    log(`Printer discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Print via the Windows GDI spooler (System.Drawing.Printing) — the path that
// actually reaches the printer on this hardware. SumatraPDF silently failed to
// spool on the shop's Epson driver, so it was removed entirely.
//   - Images print directly.
//   - PDFs are rasterised to PNG (one per page) with PDFium (WASM, no install),
//     then printed as images.
async function printJob(filePath: string, job: SupabaseJob, printer: string) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const ext = path.extname(filePath).toLowerCase();
  const isImage = [".jpg", ".jpeg", ".png", ".bmp", ".gif"].includes(ext);

  let images: string[];
  const cleanup: string[] = [];

  if (isImage) {
    images = [filePath];
  } else if (ext === ".pdf") {
    images = await renderPdfToPngs(filePath, job);
    cleanup.push(...images);
  } else {
    throw new Error(`Unsupported file type for printing: ${ext}`);
  }

  // Apply page range if specified (1-based, e.g. "1-3,5").
  if (job.page_range && images.length > 1) {
    const wanted = parsePageRange(job.page_range, images.length);
    if (wanted.length) images = wanted.map((n) => images[n - 1]).filter(Boolean);
  }

  try {
    await printImagesGDI(images, job, printer);
  } finally {
    for (const f of cleanup) await fs.rm(f, { force: true }).catch(() => undefined);
  }
}

async function renderPdfToPngs(pdfPath: string, job: SupabaseJob): Promise<string[]> {
  const buff = await fs.readFile(pdfPath);
  const library = await PDFiumLibrary.init();
  const out: string[] = [];
  try {
    const doc = await library.loadDocument(new Uint8Array(buff));
    try {
      let i = 0;
      for (const page of doc.pages()) {
        const rendered = await page.render({
          scale: 3, // ~216 DPI for A4 — sharp enough for text and images
          render: async ({ data, width, height }) => {
            // PDFium outputs BGRA; swap B<->R so colours are correct as RGBA.
            const buf = Buffer.from(data);
            for (let p = 0; p + 2 < buf.length; p += 4) {
              const b = buf[p];
              buf[p] = buf[p + 2];
              buf[p + 2] = b;
            }
            return await sharp(buf, { raw: { width, height, channels: 4 } }).png().toBuffer();
          }
        });
        const pngPath = path.resolve(config.tempDir, `${job.token}-p${i}.png`);
        await fs.writeFile(pngPath, Buffer.from(rendered.data));
        out.push(pngPath);
        i++;
      }
    } finally {
      doc.destroy();
    }
  } finally {
    library.destroy();
  }
  if (!out.length) throw new Error("PDF produced no printable pages.");
  log(`Rendered ${out.length} page(s) from PDF.`);
  return out;
}

function parsePageRange(range: string, total: number): number[] {
  const normalized = range.trim().toLowerCase();
  if (normalized === "even") {
    const out: number[] = [];
    for (let n = 2; n <= total; n += 2) out.push(n);
    return out;
  }
  if (normalized === "odd") {
    const out: number[] = [];
    for (let n = 1; n <= total; n += 2) out.push(n);
    return out;
  }

  const pages = new Set<number>();
  for (const part of range.split(",")) {
    const seg = part.trim();
    if (!seg) continue;
    const m = seg.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      const a = Math.max(1, parseInt(m[1], 10));
      const b = Math.min(total, parseInt(m[2], 10));
      for (let n = a; n <= b; n++) pages.add(n);
    } else {
      const n = parseInt(seg, 10);
      if (n >= 1 && n <= total) pages.add(n);
    }
  }
  return [...pages].sort((a, b) => a - b);
}

function printImagesGDI(images: string[], job: SupabaseJob, printer: string) {
  const scriptPath = path.resolve("agent/print-image.ps1");
  if (!existsSync(scriptPath)) {
    throw new Error("Print helper missing: agent/print-image.ps1");
  }
  const listPath = path.resolve(config.tempDir, `${job.token}-filelist.txt`);

  return new Promise<void>((resolve, reject) => {
    fs.writeFile(listPath, images.join("\r\n"), "utf8")
      .then(() => {
        const args = [
          "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath,
          "-Printer", printer,
          "-FileList", listPath,
          "-Copies", String(job.copies || 1),
          "-Color", job.print_type === "color" ? "true" : "false",
          "-Landscape", job.layout === "landscape" ? "true" : "false",
          "-PaperName", paperName(job.paper_size),
          "-Scale", job.scale || "default",
          "-Margins", job.margins || "default",
          "-PagesPerSheet", String(job.pages_per_sheet || 1),
          "-Duplex", job.duplex || "simplex",
          "-Collate", "true"
        ];
        log(`Printing ${images.length} page(s) via GDI to ${printer}...`);

        execFile("powershell.exe", args, { windowsHide: true, timeout: 120000 },
          (error, stdout, stderr) => {
            fs.rm(listPath, { force: true }).catch(() => undefined);
            if (error) {
              reject(new Error(`GDI print failed: ${(stderr || stdout || error.message).trim()}`));
              return;
            }
            log(`GDI print result: ${stdout.trim()}`);
            resolve();
          });
      })
      .catch(reject);
  });
}

function paperName(paperSize: string) {
  const map: Record<string, string> = {
    A3: "A3", A4: "A4", A5: "A5", A6: "A6", B5: "B5",
    Letter: "Letter", Legal: "Legal", Photo: "4x6"
  };
  return map[paperSize] ?? "A4";
}

async function listWindowsPrinters(): Promise<WindowsPrinter[]> {
  const script = [
    '$printers = Get-Printer | Select-Object Name,DriverName,PortName,Default',
    '$printers | ConvertTo-Json -Compress'
  ].join("; ");
  const output = await execPowerShell(script);
  if (!output.trim()) return [];
  const parsed = JSON.parse(output) as unknown;
  const printers = Array.isArray(parsed) ? parsed : [parsed];
  return printers
    .map((printer) => {
      const item = printer as Record<string, unknown>;
      return {
        name: String(item.Name ?? "").trim(),
        driverName: String(item.DriverName ?? "").trim(),
        portName: String(item.PortName ?? "").trim(),
        isDefault: Boolean(item.Default)
      };
    })
    .filter((printer) => printer.name);
}

function execPowerShell(script: string) {
  return new Promise<string>((resolve, reject) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script],
      { windowsHide: true, timeout: 15000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout);
      }
    );
  });
}

function extensionFor(mimeType: string, originalName: string) {
  const ext = path.extname(originalName);
  if (ext) return ext;
  if (mimeType === "application/pdf") return ".pdf";
  if (mimeType === "image/png") return ".png";
  return ".jpg";
}

function safeFileName(originalName: string, fallbackExtension: string) {
  const parsed = path.parse(originalName);
  const base = parsed.name || "print-job";
  const ext = parsed.ext || fallbackExtension;
  const safeBase = base.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim().slice(0, 80) || "print-job";
  return `${safeBase}${ext}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function log(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  const logLine = line + "\n";
  await fs.appendFile("agent/agent.log", logLine).catch(() => undefined);
  console.log(line);
}

async function loadConfig() {
  const configPath = path.resolve("agent/config.json");
  if (!existsSync(configPath)) {
    throw new Error("Missing agent/config.json. Copy agent/config.example.json and edit it.");
  }
  const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as Partial<AgentConfig> & Record<string, unknown>;

  const supabaseUrl = parsed.supabaseUrl || process.env.SUPABASE_URL;
  const supabaseKey = parsed.supabaseKey || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    throw new Error("Agent config must include supabaseUrl and supabaseKey (or set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY env vars).");
  }

  return {
    supabaseUrl: String(supabaseUrl).replace(/\/$/, ""),
    supabaseKey: String(supabaseKey),
    tempDir: String(parsed.tempDir || "./agent-temp"),
    maxRetries: Number(parsed.maxRetries) || 3,
    fallbackPrinter: String(parsed.fallbackPrinter || "")
  };
}

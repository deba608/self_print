import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";
import { createClient, RealtimeChannel } from "@supabase/supabase-js";

type AgentConfig = {
  supabaseUrl: string;
  supabaseKey: string;
  sumatraPath?: string;
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
            await processJob(jobId);
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
  if (isProcessing || isShuttingDown) return;
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

    const { data: file, error: fileError } = await supabase
      .from("job_files")
      .select("*")
      .eq("job_id", jobId)
      .single() as { data: SupabaseJobFile | null; error: { message: string } | null };

    if (fileError || !file) {
      await updateStatus(jobId, "failed", "No file found for this job.");
      log(`No file found for job ${jobId}`);
      return;
    }

    const extension = extensionFor(file.mime_type, file.original_name);
    const tempPath = path.resolve(
      config.tempDir,
      `${job.token}-${safeFileName(file.original_name, extension)}`
    );

    await updateStatus(jobId, "printing", "Agent downloading file...");

    let attempt = 0;
    while (attempt < config.maxRetries) {
      attempt++;
      try {
        log(`Downloading file (attempt ${attempt}/${config.maxRetries})...`);

        let fileBytes: Buffer;
        const storagePath = file.storage_path;

        // Resolve the object path inside the "selfprint" bucket. Uploads may store
        // a relative path (originals/x.pdf) OR a full Supabase URL (public/sign/
        // authenticated). In all those cases download via the service-role SDK so
        // it works even though the bucket is PRIVATE (plain fetch on a private
        // bucket's public URL returns 400).
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

        await fs.writeFile(tempPath, fileBytes);
        log(`File downloaded: ${fileBytes.length} bytes`);

        const printer = cachedPrinterName || config.fallbackPrinter;
        if (!printer) throw new Error("No printer selected. Set a printer in admin dashboard.");

        log(`Printing ${job.copies} copy(s), paper: ${job.paper_size}, type: ${job.print_type}, printer: ${printer}...`);
        await printWithSumatra(tempPath, job, printer);

        await updateStatus(jobId, "printed", `Printed successfully on attempt ${attempt}.`);
        log(`Job ${job.token} completed successfully.`);
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
      }
    }

    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  } catch (error) {
    log(`Job processing error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    isProcessing = false;
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

    await (supabase.from("agent_printers") as any).delete().neq("name", "");

    for (const printer of printers) {
      await (supabase.from("agent_printers") as any).insert([{
        name: printer.name,
        driver_name: printer.driverName,
        port_name: printer.portName,
        is_default: printer.isDefault ? 1 : 0,
        seen_at: new Date().toISOString()
      }]);
    }

    log(`Reported ${printers.length} printer(s) to Supabase.`);
  } catch (error) {
    log(`Printer discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function printWithSumatra(
  filePath: string,
  job: SupabaseJob,
  printer: string
) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const sumatraPath = resolveSumatraPath();
  if (!sumatraPath) {
    throw new Error("Print engine not found. Put SumatraPDF.exe in agent/vendor/ or set sumatraPath in config.");
  }

  const printSettings = buildPrintSettings(job);
  const args: string[] = ["-silent", "-exit-when-done", "-print-to", printer];
  if (printSettings) args.push("-print-settings", printSettings);
  args.push(filePath);

  log(`Running: ${sumatraPath} ${args.join(" ")}`);

  return new Promise<void>((resolve, reject) => {
    const child = spawn(sumatraPath, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";
    let settled = false;

    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      reject(new Error(`Print engine failed to start: ${err.message}`));
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      if (code === 0) {
        resolve();
      } else {
        const errorDetail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(`Print engine failed: ${errorDetail}`));
      }
    });

    setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error("Print timeout after 120 seconds"));
    }, 120000);
  });
}

function resolveSumatraPath() {
  const candidates = [
    config.sumatraPath,
    path.resolve("agent/vendor/SumatraPDF.exe"),
    "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe",
    "C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe",
    path.resolve(process.env.LOCALAPPDATA || "", "SumatraPDF\\SumatraPDF.exe")
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function buildPrintSettings(job: SupabaseJob) {
  const settings: string[] = [];
  if (job.page_range) settings.push(job.page_range.replace(/\s+/g, ""));
  if (job.copies > 1) settings.push(`copies=${job.copies}`);
  if (job.pages_per_sheet > 1) settings.push(`${job.pages_per_sheet}x`);
  settings.push(job.print_type === "color" ? "color" : "monochrome");
  settings.push(job.layout === "landscape" ? "landscape" : "portrait");
  const paper = paperSetting(job.paper_size);
  if (paper) settings.push(`paper=${paper}`);
  if (job.scale !== "default") settings.push(`scale=${job.scale}`);
  return settings.join(",");
}

function paperSetting(paperSize: string) {
  const map: Record<string, string> = {
    A3: "A3",
    A4: "A4",
    A5: "A5",
    A6: "A6",
    B5: "B5",
    Letter: "letter",
    Legal: "legal",
    Photo: "4x6"
  };
  return map[paperSize] ?? null;
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
    sumatraPath: parsed.sumatraPath ? String(parsed.sumatraPath) : undefined,
    tempDir: String(parsed.tempDir || "./agent-temp"),
    maxRetries: Number(parsed.maxRetries) || 3,
    fallbackPrinter: String(parsed.fallbackPrinter || "")
  };
}

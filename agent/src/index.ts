import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { execFile, spawn } from "node:child_process";

type AgentConfig = {
  serverUrl: string;
  agentToken: string;
  sumatraPath?: string;
  pollIntervalMs: number;
  tempDir: string;
  maxRetries: number;
  fallbackPrinter: string;
};

type AgentJob = {
  job: {
    id: string;
    token: string;
    printType: "bw" | "color";
    copies: number;
    pageRange: string | null;
    paperSize: "A3" | "A4" | "A5" | "A6" | "B5" | "Letter" | "Legal" | "Photo";
    layout: "portrait" | "landscape";
    scale: "default" | "fit" | "shrink" | "noscale";
  } | null;
  file?: {
    originalName: string;
    mimeType: string;
    fileKind: "pdf" | "image" | "document";
    sizeBytes: number;
  };
  printerName?: string;
};

let config: AgentConfig;
let isShuttingDown = false;
let cachedPrinterName = "";
let lastPrinterReportAt = 0;

async function main() {
  config = await loadConfig();
  cachedPrinterName = config.fallbackPrinter;
  await fs.mkdir(config.tempDir, { recursive: true });
  log(`=== Agent started ===`);
  log(`Server: ${config.serverUrl}`);
  log(`Poll interval: ${config.pollIntervalMs}ms`);

  process.on("SIGINT", () => {
    log("Received shutdown signal, finishing current job...");
    isShuttingDown = true;
  });

  setInterval(async () => {
    if (isShuttingDown) return;
    await pollOnce().catch((error) => log(`Poll error: ${error.message}`));
  }, config.pollIntervalMs);

  await pollOnce().catch((error) => log(`Initial poll error: ${error.message}`));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

async function pollOnce() {
  await reportPrintersIfNeeded();

  const printerConfig = await api<{ printerName: string; configVersion: number }>("/api/agent/printer");
  if (printerConfig?.printerName) {
    cachedPrinterName = printerConfig.printerName;
    log(`Printer: ${cachedPrinterName}`);
  }

  const next = await api<AgentJob>("/api/agent/jobs/next");
  if (!next.job || !next.file) return;

  log(`Processing job ${next.job.token} (${next.file.originalName})`);

  const job = next.job;
  const extension = extensionFor(next.file.mimeType, next.file.originalName);
  const tempPath = path.resolve(config.tempDir, `${job.token}-${safeFileName(next.file.originalName, extension)}`);

  try {
    let attempt = 0;
    while (attempt < config.maxRetries) {
      attempt++;
      try {
        await updateStatus(job.id, "printing", `Agent attempting print (attempt ${attempt}/${config.maxRetries}).`);
        log(`Downloading file for job ${job.token}...`);

        const fileResponse = await fetch(`${config.serverUrl}/api/agent/jobs/${job.id}/file`, {
          headers: authHeaders()
        });
        if (!fileResponse.ok) throw new Error(`Download failed: ${fileResponse.status}`);

        const fileBytes = Buffer.from(await fileResponse.arrayBuffer());
        const expectedSize = Number(fileResponse.headers.get("x-original-file-size") ?? next.file.sizeBytes);
        if (Number.isFinite(expectedSize) && expectedSize > 0 && fileBytes.length !== expectedSize) {
          throw new Error(`Downloaded file size mismatch: expected ${expectedSize} bytes, got ${fileBytes.length} bytes`);
        }
        await fs.writeFile(tempPath, fileBytes);
        log(`File downloaded to ${tempPath} (${fileBytes.length} bytes)`);

        const printer = cachedPrinterName || config.fallbackPrinter;
        log(`Printing ${job.copies} copy(s), paper: ${job.paperSize}, type: ${job.printType}, printer: ${printer}...`);
        await printWithSumatra(tempPath, job, printer);

        await updateStatus(job.id, "printed", `Printed successfully on attempt ${attempt}.`);
        log(`Job ${job.token} completed successfully.`);
        break;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        log(`Job ${job.token} attempt ${attempt} failed: ${errorMsg}`);

        if (attempt >= config.maxRetries) {
          await updateStatus(job.id, "failed", `Failed after ${config.maxRetries} attempts: ${errorMsg}`);
          log(`Job ${job.token} failed permanently.`);
        } else {
          await updateStatus(job.id, "printing", `Retry ${attempt}/${config.maxRetries} after error: ${errorMsg}`);
          await sleep(2000);
        }
      }
    }
  } finally {
    await fs.rm(tempPath, { force: true }).catch(() => undefined);
  }
}

async function reportPrintersIfNeeded() {
  const now = Date.now();
  if (now - lastPrinterReportAt < 60000) return;
  lastPrinterReportAt = now;
  try {
    const printers = await listWindowsPrinters();
    if (!printers.length) {
      log("No Windows printers detected.");
      return;
    }
    await api("/api/agent/printers", {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ printers })
    });
    log(`Reported ${printers.length} printer(s) to server.`);
  } catch (error) {
    log(`Printer discovery failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function printWithSumatra(filePath: string, job: NonNullable<AgentJob["job"]>, printer: string) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const sumatraPath = resolveSumatraPath();
  if (!sumatraPath) {
    throw new Error("Print engine not found. Put SumatraPDF.exe in electron-agent/vendor or set sumatraPath in agent/config.json.");
  }

  const printSettings = buildPrintSettings(job);
  const args: string[] = ["-silent", "-exit-when-done", "-print-to", printer];
  if (printSettings) args.push("-print-settings", printSettings);
  args.push(filePath);

  log(`Running bundled print engine: ${sumatraPath} ${args.join(" ")}`);

  return new Promise<void>((resolve, reject) => {
    const child = spawn(sumatraPath, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";
    let settled = false;

    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });

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
    path.resolve("electron-agent/vendor/SumatraPDF.exe"),
    path.resolve("agent/vendor/SumatraPDF.exe"),
    "C:\\Program Files\\SumatraPDF\\SumatraPDF.exe",
    "C:\\Program Files (x86)\\SumatraPDF\\SumatraPDF.exe"
  ].filter(Boolean) as string[];

  return candidates.find((candidate) => existsSync(candidate)) || "";
}

function buildPrintSettings(job: NonNullable<AgentJob["job"]>) {
  const settings: string[] = [];
  if (job.pageRange) settings.push(job.pageRange.replace(/\s+/g, ""));
  if (job.copies > 1) settings.push(`${job.copies}x`);
  settings.push(job.printType === "color" ? "color" : "monochrome");
  settings.push(job.layout === "landscape" ? "landscape" : "portrait");
  const paper = paperSetting(job.paperSize);
  if (paper) settings.push(`paper=${paper}`);
  if (job.scale !== "default") settings.push(job.scale);
  return settings.join(",");
}

function paperSetting(paperSize: NonNullable<AgentJob["job"]>["paperSize"]) {
  const map: Record<string, string> = {
    A3: "A3", A4: "A4", A5: "A5", A6: "A6",
    B5: "B5", Letter: "letter", Legal: "legal", Photo: "4x6"
  };
  return map[paperSize] ?? null;
}

type WindowsPrinter = {
  name: string;
  driverName: string;
  portName: string;
  isDefault: boolean;
};

async function listWindowsPrinters(): Promise<WindowsPrinter[]> {
  const script = [
    "$printers = Get-Printer | Select-Object Name,DriverName,PortName,Default",
    "$printers | ConvertTo-Json -Compress"
  ].join("; ");
  const output = await execPowerShell(script);
  if (!output.trim()) return [];
  const parsed = JSON.parse(output) as unknown;
  const printers = Array.isArray(parsed) ? parsed : [parsed];
  return printers.map((printer) => {
    const item = printer as Record<string, unknown>;
    return {
      name: String(item.Name ?? "").trim(),
      driverName: String(item.DriverName ?? "").trim(),
      portName: String(item.PortName ?? "").trim(),
      isDefault: Boolean(item.Default)
    };
  }).filter((printer) => printer.name);
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

async function updateStatus(jobId: string, status: "printing" | "printed" | "failed", message: string) {
  try {
    await api(`/api/agent/jobs/${jobId}/status`, {
      method: "POST",
      headers: { ...authHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({ status, message })
    });
  } catch (error) {
    log(`Failed to update status: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function api<T>(pathname: string, init?: RequestInit & { headers?: Record<string, string> }): Promise<T> {
  const response = await fetch(`${config.serverUrl}${pathname}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) }
  });
  if (!response.ok) throw new Error(`${pathname} returned ${response.status}: ${await response.text()}`);
  return response.json() as Promise<T>;
}

function authHeaders() {
  return { Authorization: `Bearer ${config.agentToken}` };
}

async function loadConfig() {
  const configPath = path.resolve("agent/config.json");
  if (!existsSync(configPath)) {
    throw new Error("Missing agent/config.json. Copy agent/config.example.json and edit it.");
  }
  const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as AgentConfig;
  if (!parsed.serverUrl || !parsed.agentToken) {
    throw new Error("Agent config must include serverUrl and agentToken.");
  }
  parsed.pollIntervalMs = parsed.pollIntervalMs || 5000;
  parsed.tempDir = parsed.tempDir || "./agent-temp";
  parsed.maxRetries = parsed.maxRetries || 3;
  parsed.fallbackPrinter = parsed.fallbackPrinter || "Microsoft Print to PDF";
  parsed.serverUrl = parsed.serverUrl.replace(/\/$/, "");
  return parsed;
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
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function log(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  const logLine = line + "\n";
  await fs.appendFile("agent/agent.log", logLine).catch(() => undefined);
  console.log(line);
}

import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";

type AgentConfig = {
  serverUrl: string;
  agentToken: string;
  sumatraPath: string;
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
    paperSize: "A4" | "Letter" | "Legal" | "Photo";
    layout: "portrait" | "landscape";
    pagesPerSheet: number;
    margins: "default" | "none" | "minimum";
    scale: "default" | "fit" | "shrink" | "noscale";
  } | null;
  file?: {
    originalName: string;
    mimeType: string;
    fileKind: "pdf" | "image" | "document";
  };
  printerName?: string;
};

let config: AgentConfig;
let isShuttingDown = false;
let cachedPrinterName = "";

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
  const tempPath = path.resolve(config.tempDir, `${job.token}-${job.id}${extension}`);

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

        await fs.writeFile(tempPath, Buffer.from(await fileResponse.arrayBuffer()));
        log(`File downloaded to ${tempPath}`);

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

async function printWithSumatra(filePath: string, job: NonNullable<AgentJob["job"]>, printer: string) {
  if (!existsSync(config.sumatraPath)) {
    throw new Error(`SumatraPDF not found at ${config.sumatraPath}. Please check sumatraPath in config.json`);
  }

  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }

  const printSettings = buildPrintSettings(job);
  const args = ["-silent", "-exit-when-done", "-print-to", printer];
  if (printSettings) args.push("-print-settings", printSettings);
  args.push(filePath);

  log(`Running: ${config.sumatraPath} ${args.join(" ")}`);

  return new Promise<void>((resolve, reject) => {
    const child = spawn(config.sumatraPath, args, { windowsHide: true });
    let stderr = "";
    let stdout = "";

    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("error", (err) => reject(new Error(`Failed to spawn SumatraPDF: ${err.message}`)));

    child.on("exit", (code) => {
      if (code === 0) {
        log(`SumatraPDF completed successfully`);
        resolve();
      } else {
        const errorDetail = stderr.trim() || stdout.trim() || `exit code ${code}`;
        reject(new Error(`SumatraPDF failed: ${errorDetail}`));
      }
    });

    setTimeout(() => {
      if (!child.killed) {
        child.kill();
        reject(new Error("Print timeout after 120 seconds"));
      }
    }, 120000);
  });
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
  if (paperSize === "A4") return "A4";
  if (paperSize === "Letter") return "letter";
  if (paperSize === "Legal") return "legal";
  return null;
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
  if (!parsed.serverUrl || !parsed.agentToken || !parsed.sumatraPath) {
    throw new Error("Agent config must include serverUrl, agentToken, and sumatraPath.");
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

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function log(message: string) {
  const line = `[${new Date().toISOString()}] ${message}`;
  const logLine = line + "\n";
  await fs.appendFile("agent/agent.log", logLine).catch(() => undefined);
  console.log(line);
}

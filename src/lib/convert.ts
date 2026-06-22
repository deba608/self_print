import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";

// Candidate LibreOffice executable locations (Windows / Linux / macOS).
const CANDIDATES = [
  process.env.LIBREOFFICE_PATH,
  "C:/Program Files/LibreOffice/program/soffice.exe",
  "C:/Program Files (x86)/LibreOffice/program/soffice.exe",
  "/usr/bin/soffice",
  "/usr/bin/libreoffice",
  "/opt/libreoffice/program/soffice",
  "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  "soffice"
].filter(Boolean) as string[];

async function resolveSoffice(): Promise<string> {
  for (const candidate of CANDIDATES) {
    // Bare command names (no separator) are resolved via PATH at spawn time.
    if (!candidate.includes("/") && !candidate.includes("\\")) return candidate;
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error(
    "LibreOffice not found. Install it or set LIBREOFFICE_PATH to soffice(.exe)."
  );
}

function run(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`LibreOffice exited ${code}: ${stderr.trim()}`));
    });
  });
}

// Converts DOC/DOCX bytes to a PDF buffer using LibreOffice headless.
// Output paper size follows the source document; final paper/scale is still
// applied by the print agent at print time per the job's paperSize setting.
export async function convertDocToPdf(inputBytes: Buffer, ext: string): Promise<Buffer> {
  const soffice = await resolveSoffice();
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "selfprint-convert-"));
  const inputPath = path.join(workDir, `source${ext}`);

  try {
    await fs.writeFile(inputPath, inputBytes);
    await run(soffice, [
      "--headless",
      "--norestore",
      "--convert-to",
      "pdf:writer_pdf_Export",
      "--outdir",
      workDir,
      inputPath
    ]);
    const outPath = path.join(workDir, "source.pdf");
    return await fs.readFile(outPath);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

export async function isLibreOfficeAvailable(): Promise<boolean> {
  try {
    await resolveSoffice();
    return true;
  } catch {
    return false;
  }
}

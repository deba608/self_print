import { MAX_UPLOAD_BYTES } from "./config";
import { validateUpload } from "./files";
import { isValidStoredName } from "./storage";

export const MAX_BULK_FILES = 10;

export type BulkFileMeta = {
  storedName: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  pageCount: number;
};

// Parses and validates the client-supplied file metadata for a bulk upload.
// Pure: no DB or network. Real bytes were already validated by the sign step;
// here we re-check type, count, and size so a forged request can't slip through.
export function parseBulkFiles(raw: unknown): { files: BulkFileMeta[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "Invalid file list." };
  if (raw.length === 0) return { error: "Select at least one PDF." };
  if (raw.length > MAX_BULK_FILES) return { error: `You can upload at most ${MAX_BULK_FILES} files at once.` };

  const files: BulkFileMeta[] = [];
  let total = 0;
  for (const entry of raw) {
    const e = entry as Record<string, unknown>;
    const storedName = String(e.storedName ?? "");
    const originalName = String(e.originalName ?? "");
    const mimeType = String(e.mimeType ?? "");
    const sizeBytes = Math.max(1, Math.floor(Number(e.sizeBytes ?? 0)));
    const pageCount = Math.max(1, Math.min(1000, Math.floor(Number(e.pageCount ?? 1)) || 1));

    if (!storedName || !originalName || !isValidStoredName(storedName)) return { error: "Invalid upload metadata." };

    // PDF-only in bulk. validateUpload throws on non-PDF/JPG/PNG; then we also
    // require the resolved kind to be pdf.
    let kind: string;
    try {
      ({ kind } = validateUpload(originalName, mimeType));
    } catch {
      return { error: "Bulk upload accepts PDF files only." };
    }
    if (kind !== "pdf") return { error: "Bulk upload accepts PDF files only." };

    if (!Number.isFinite(sizeBytes) || sizeBytes > MAX_UPLOAD_BYTES) {
      return { error: `"${originalName}" is too large.` };
    }
    total += sizeBytes;
    files.push({ storedName, originalName, mimeType, sizeBytes, pageCount });
  }

  if (total > MAX_UPLOAD_BYTES * MAX_BULK_FILES) {
    return { error: "Total upload size is too large." };
  }
  return { files };
}

export function sumPages(files: BulkFileMeta[]): number {
  return files.reduce((sum, f) => sum + Math.max(1, f.pageCount), 0);
}

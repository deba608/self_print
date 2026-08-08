import crypto from "node:crypto";
import path from "node:path";
import { ORIGINALS_DIR, CONVERTED_DIR, MAX_UPLOAD_BYTES } from "./config";
import type { FileKind } from "./types";
import { saveUpload as saveToStorage, readFileBytes } from "./storage";

const allowed = new Map<string, { extensions: string[]; kind: FileKind }>([
  ["application/pdf", { extensions: [".pdf"], kind: "pdf" }],
  ["image/jpeg", { extensions: [".jpg", ".jpeg"], kind: "image" }],
  ["image/png", { extensions: [".png"], kind: "image" }]
]);

// Some Android browsers report an empty MIME type for valid files.
// Fall back to an extension-based guess so those uploads aren't rejected.
const extToMime: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

export function validateUpload(fileName: string, mimeType: string) {
  const ext = path.extname(fileName).toLowerCase();
  const effectiveMime = mimeType || extToMime[ext] || "";
  const rule = allowed.get(effectiveMime);
  if (!rule || !rule.extensions.includes(ext)) {
    throw new Error("Only PDF, JPG, and PNG files are allowed. Please convert Word documents to PDF before uploading.");
  }
  return { ext, kind: rule.kind };
}

export async function saveUpload(file: File, ext: string, kind: FileKind = "pdf") {
  return saveToStorage(file, ext, kind);
}

export function estimatePageCount(kind: FileKind, bytes: Buffer) {
  if (kind === "image") return 1;
  if (kind === "document") return 0;
  const text = bytes.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return Math.max(matches?.length ?? 1, 1);
}

/**
 * Reads an already-uploaded object back from storage and derives its real size
 * and page count. Used by the direct-upload and bulk flows, where the browser
 * uploads straight to Supabase Storage: the client's own reported sizeBytes /
 * pageCount must never reach pricing, because a forged `pageCount=1` on a
 * 300-page PDF would be billed as one page while the agent still prints all
 * 300. Costs one object download, which is why it runs once per job creation.
 */
export async function measureStoredFile(
  kind: FileKind,
  storagePath: string
): Promise<{ sizeBytes: number; pageCount: number }> {
  const bytes = await readFileBytes(storagePath);
  if (bytes.length > MAX_UPLOAD_BYTES) {
    throw new Error("File is too large");
  }
  return { sizeBytes: bytes.length, pageCount: estimatePageCount(kind, bytes) };
}

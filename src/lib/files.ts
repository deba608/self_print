import crypto from "node:crypto";
import path from "node:path";
import { ORIGINALS_DIR, CONVERTED_DIR } from "./config";
import type { FileKind } from "./types";
import { saveUpload as saveToStorage } from "./storage";

const allowed = new Map<string, { extensions: string[]; kind: FileKind }>([
  ["application/pdf", { extensions: [".pdf"], kind: "pdf" }],
  ["image/jpeg", { extensions: [".jpg", ".jpeg"], kind: "image" }],
  ["image/png", { extensions: [".png"], kind: "image" }]
]);

export function validateUpload(fileName: string, mimeType: string) {
  const ext = path.extname(fileName).toLowerCase();
  const rule = allowed.get(mimeType);
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

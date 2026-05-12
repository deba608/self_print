import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ORIGINALS_DIR } from "./config";
import type { FileKind } from "./types";

const allowed = new Map<string, { extensions: string[]; kind: FileKind }>([
  ["application/pdf", { extensions: [".pdf"], kind: "pdf" }],
  ["image/jpeg", { extensions: [".jpg", ".jpeg"], kind: "image" }],
  ["image/png", { extensions: [".png"], kind: "image" }],
  ["application/msword", { extensions: [".doc"], kind: "document" }],
  ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", { extensions: [".docx"], kind: "document" }]
]);

export function validateUpload(file: File) {
  const ext = path.extname(file.name).toLowerCase();
  const rule = allowed.get(file.type);
  if (!rule || !rule.extensions.includes(ext)) {
    throw new Error("Only PDF, JPG, PNG, DOC, and DOCX files are allowed.");
  }
  return { ext, kind: rule.kind };
}

export async function saveUpload(file: File, ext: string) {
  await fs.mkdir(ORIGINALS_DIR, { recursive: true });
  const storedName = `${crypto.randomUUID()}${ext}`;
  const storagePath = path.join(ORIGINALS_DIR, storedName);
  const bytes = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(storagePath, bytes);
  return { storedName, storagePath, sizeBytes: bytes.length, bytes };
}

export function estimatePageCount(kind: FileKind, bytes: Buffer) {
  if (kind === "image") return 1;
  if (kind === "document") return 0;
  const text = bytes.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page\b/g);
  return Math.max(matches?.length ?? 1, 1);
}

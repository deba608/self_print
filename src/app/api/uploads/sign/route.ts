import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MAX_BULK_FILES } from "@/lib/bulk";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { validateUpload } from "@/lib/files";
import { cloudStorageEnabled, createSignedUpload, signStoredName } from "@/lib/storage";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

// Issues a short-lived signed upload URL for direct browser -> Supabase upload.
// The server owns validation and the object path; the bucket stays private.

const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5; // 5 sign requests per minute per IP

export async function POST(request: NextRequest) {
  if (!cloudStorageEnabled) {
    return NextResponse.json({ error: "Direct upload not available" }, { status: 400 });
  }

  const ip = clientIp(request.headers);
  if (isRateLimited("uploads-sign", ip, MAX_REQUESTS_PER_WINDOW, RATE_LIMIT_WINDOW_MS)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  let body: { fileName?: string; mimeType?: string; sizeBytes?: number; files?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  // Batch mode: { files: [{ fileName, mimeType, sizeBytes }, ...] }
  if (Array.isArray((body as any).files)) {
    const entries = (body as any).files as Array<{ fileName?: string; mimeType?: string; sizeBytes?: number }>;
    if (entries.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }
    if (entries.length > MAX_BULK_FILES) {
      return NextResponse.json({ error: `You can upload at most ${MAX_BULK_FILES} files at once.` }, { status: 400 });
    }

    const uploads: Array<{ signedUrl: string; token: string; objectPath: string; storedName: string; kind: string; uploadSig: string }> = [];
    for (const entry of entries) {
      const fileName = String(entry.fileName ?? "");
      const mimeType = String(entry.mimeType ?? "");
      const sizeBytes = Number(entry.sizeBytes ?? 0);
      if (!fileName || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
        return NextResponse.json({ error: "File name and size are required" }, { status: 400 });
      }
      if (sizeBytes > MAX_UPLOAD_BYTES) {
        return NextResponse.json({ error: `"${fileName}" is too large` }, { status: 400 });
      }
      let ext: string, kind: string;
      try {
        ({ ext, kind } = validateUpload(fileName, mimeType));
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid file type" }, { status: 400 });
      }
      if (kind !== "pdf") {
        return NextResponse.json({ error: "Bulk upload accepts PDF files only." }, { status: 400 });
      }
      const storedName = `${crypto.randomUUID()}${ext}`;
      try {
        const { signedUrl, token, objectPath } = await createSignedUpload(kind, storedName);
        uploads.push({ signedUrl, token, objectPath, storedName, kind, uploadSig: signStoredName(storedName) });
      } catch (error) {
        return NextResponse.json({ error: error instanceof Error ? error.message : "Could not create upload URL" }, { status: 500 });
      }
    }
    return NextResponse.json({ uploads });
  }

  // Single-file mode (unchanged)
  const fileName = String(body.fileName ?? "");
  const mimeType = String(body.mimeType ?? "");
  const sizeBytes = Number(body.sizeBytes ?? 0);

  if (!fileName || !Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return NextResponse.json({ error: "File name and size are required" }, { status: 400 });
  }
  if (sizeBytes > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File is too large" }, { status: 400 });
  }

  let ext: string;
  let kind: string;
  try {
    ({ ext, kind } = validateUpload(fileName, mimeType));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Invalid file type" },
      { status: 400 }
    );
  }

  const storedName = `${crypto.randomUUID()}${ext}`;

  try {
    const { signedUrl, token, objectPath } = await createSignedUpload(kind, storedName);
    return NextResponse.json({ signedUrl, token, objectPath, storedName, kind, uploadSig: signStoredName(storedName) });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create upload URL" },
      { status: 500 }
    );
  }
}

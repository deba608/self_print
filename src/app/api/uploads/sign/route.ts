import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { validateUpload } from "@/lib/files";
import { cloudStorageEnabled, createSignedUpload } from "@/lib/storage";

// Issues a short-lived signed upload URL for direct browser -> Supabase upload.
// The server owns validation and the object path; the bucket stays private.
export async function POST(request: NextRequest) {
  if (!cloudStorageEnabled) {
    return NextResponse.json({ error: "Direct upload not available" }, { status: 400 });
  }

  let body: { fileName?: string; mimeType?: string; sizeBytes?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

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
    return NextResponse.json({ signedUrl, token, objectPath, storedName, kind });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not create upload URL" },
      { status: 500 }
    );
  }
}

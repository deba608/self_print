import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { MAX_UPLOAD_BYTES } from "@/lib/config";
import { validateUpload } from "@/lib/files";
import { cloudStorageEnabled, createSignedUpload } from "@/lib/storage";

// Issues a short-lived signed upload URL for direct browser -> Supabase upload.
// The server owns validation and the object path; the bucket stays private.

// Basic in-memory rate limiter for serverless instances
const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS_PER_WINDOW = 5; // 5 uploads per minute per IP

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  let entry = rateLimitMap.get(ip);

  if (!entry || now - entry.lastReset > RATE_LIMIT_WINDOW_MS) {
    entry = { count: 1, lastReset: now };
    rateLimitMap.set(ip, entry);
    
    // Periodically sweep old entries if map gets too large
    if (rateLimitMap.size > 1000) {
      for (const [key, val] of rateLimitMap.entries()) {
        if (now - val.lastReset > RATE_LIMIT_WINDOW_MS) {
          rateLimitMap.delete(key);
        }
      }
    }
    return false;
  }

  entry.count++;
  return entry.count > MAX_REQUESTS_PER_WINDOW;
}

export async function POST(request: NextRequest) {
  if (!cloudStorageEnabled) {
    return NextResponse.json({ error: "Direct upload not available" }, { status: 400 });
  }

  const ip = request.headers.get("x-forwarded-for") ?? "unknown";
  if (isRateLimited(ip)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
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

import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getJobFileById } from "@/lib/db";
import { createSignedDownloadUrl, readFileStream } from "@/lib/storage";
import { requireAdminResponse } from "@/lib/security";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;

  if (isRateLimited("file-serve-admin", clientIp(request.headers), 120, 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const { id } = await params;

  let file;
  try {
    file = await getJobFileById(id);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  if (!file.storagePath) {
    return NextResponse.json({ error: "File was removed after the retention period." }, { status: 404 });
  }

  // Proxy mode: stream the bytes through this same-origin route instead of
  // redirecting to a cross-origin signed URL. Required for the manual-print
  // page, whose browser fetch()/iframe would otherwise be blocked by CORS.
  if (request.nextUrl.searchParams.get("proxy") === "1") {
    let stream: ReadableStream;
    try {
      stream = await readFileStream(file.storagePath);
    } catch {
      return NextResponse.json({ error: "Stored file missing" }, { status: 404 });
    }
    return new NextResponse(stream, {
      headers: {
        "Content-Type": file.mimeType,
        "Content-Length": String(file.sizeBytes),
        "Content-Disposition": `inline; filename="${file.originalName.replaceAll('"', "")}"`
      }
    });
  }

  // For cloud storage, redirect to a short-lived signed URL (bucket is private)
  const signedUrl = await createSignedDownloadUrl(file.storagePath);
  if (signedUrl) {
    return NextResponse.redirect(signedUrl);
  }

  // For local filesystem, serve the file directly
  if (!fs.existsSync(file.storagePath)) return NextResponse.json({ error: "Stored file missing" }, { status: 404 });
  
  return new NextResponse(fs.readFileSync(file.storagePath), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `inline; filename="${file.originalName.replaceAll('"', "")}"`
    }
  });
}

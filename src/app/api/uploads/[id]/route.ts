import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getJobFileById } from "@/lib/db";
import { createSignedDownloadUrl } from "@/lib/storage";
import { requireAdminResponse } from "@/lib/security";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;

  let file;
  try {
    file = await getJobFileById(id);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
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

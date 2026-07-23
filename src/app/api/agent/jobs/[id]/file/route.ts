import { NextRequest, NextResponse } from "next/server";
import { getJobFile } from "@/lib/db";
import { createSignedDownloadUrl } from "@/lib/storage";
import { verifyAgentToken } from "@/lib/security";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!(await verifyAgentToken(request.headers.get("authorization")))) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }

  if (isRateLimited("file-serve-agent", clientIp(request.headers), 120, 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const { id } = await params;
  
  let file;
  try {
    file = await getJobFile(id);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  
  if (file.fileKind === "document") return NextResponse.json({ error: "Document needs conversion" }, { status: 400 });

  // For cloud storage, return a short-lived signed URL for the agent to download
  const signedUrl = await createSignedDownloadUrl(file.storagePath);
  if (signedUrl) {
    return NextResponse.json({
      url: signedUrl,
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      originalName: file.originalName
    });
  }

  // For local filesystem, return the file directly
  const fs = await import("node:fs");
  if (!fs.existsSync(file.storagePath)) return NextResponse.json({ error: "Stored file missing" }, { status: 404 });
  
  return new NextResponse(fs.readFileSync(file.storagePath), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.sizeBytes),
      "X-Original-File-Size": String(file.sizeBytes),
      "X-Original-File-Name": encodeURIComponent(file.originalName),
      "Content-Disposition": `attachment; filename="${file.originalName.replaceAll('"', "")}"`
    }
  });
}

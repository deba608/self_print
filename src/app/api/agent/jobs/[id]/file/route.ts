import { NextRequest, NextResponse } from "next/server";
import { getJobFile } from "@/lib/db";
import { verifyAgentToken } from "@/lib/security";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyAgentToken(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }
  const { id } = await params;
  
  let file;
  try {
    file = await getJobFile(id);
  } catch {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  
  if (file.fileKind === "document") return NextResponse.json({ error: "Document needs conversion" }, { status: 400 });
  
  // For Supabase/Vercel Blob, return the URL for the agent to download
  if (file.storagePath.startsWith("http")) {
    return NextResponse.json({ 
      url: file.storagePath,
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

import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getJobFileById } from "@/lib/db";
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
  
  // For cloud storage, redirect to the URL
  if (file.storagePath.startsWith("http")) {
    return NextResponse.redirect(file.storagePath);
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

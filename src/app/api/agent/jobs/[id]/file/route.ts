import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getDb, mapJobFile } from "@/lib/db";
import { verifyAgentToken } from "@/lib/security";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifyAgentToken(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "Invalid agent token" }, { status: 401 });
  }
  const { id } = await params;
  const row = getDb().prepare("SELECT * FROM job_files WHERE job_id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "File not found" }, { status: 404 });
  const file = mapJobFile(row);
  if (file.fileKind === "document") return NextResponse.json({ error: "Document needs conversion" }, { status: 400 });
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

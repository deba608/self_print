import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { getDb, mapJobFile } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const { id } = await params;
  const row = getDb().prepare("SELECT * FROM job_files WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return NextResponse.json({ error: "File not found" }, { status: 404 });
  const file = mapJobFile(row);
  if (!fs.existsSync(file.storagePath)) return NextResponse.json({ error: "Stored file missing" }, { status: 404 });
  return new NextResponse(fs.readFileSync(file.storagePath), {
    headers: {
      "Content-Type": file.mimeType,
      "Content-Length": String(file.sizeBytes),
      "Content-Disposition": `inline; filename="${file.originalName.replaceAll('"', "")}"`
    }
  });
}

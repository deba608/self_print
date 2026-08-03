import fs from "node:fs";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createSignedDownloadUrl, readFileStream } from "@/lib/storage";
import { clientIp, isRateLimited } from "@/lib/ratelimit";

// Lets a signed-in customer view/download an original upload for one of
// their own jobs. Ownership is enforced by the "customers can view own job
// files" RLS policy on job_files — this query returns nothing for a file
// that isn't theirs, so there's no separate authorization check to get wrong.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  if (isRateLimited("file-serve-customer", clientIp(request.headers), 60, 60 * 1000)) {
    return NextResponse.json({ error: "Too many requests. Please try again later." }, { status: 429 });
  }

  const { id } = await params;

  const { data: file, error } = await supabase
    .from("job_files")
    .select("original_name, storage_path, mime_type, size_bytes, purged_at")
    .eq("id", id)
    .single();

  if (error || !file) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }
  if (!file.storage_path || file.purged_at) {
    return NextResponse.json({ error: "File was removed after the retention period." }, { status: 404 });
  }

  const signedUrl = await createSignedDownloadUrl(file.storage_path);
  if (signedUrl) {
    return NextResponse.redirect(signedUrl);
  }

  // Local filesystem storage
  if (!fs.existsSync(file.storage_path)) {
    return NextResponse.json({ error: "Stored file missing" }, { status: 404 });
  }
  const stream = await readFileStream(file.storage_path);
  return new NextResponse(stream, {
    headers: {
      "Content-Type": file.mime_type ?? "application/octet-stream",
      "Content-Length": String(file.size_bytes ?? 0),
      "Content-Disposition": `inline; filename="${String(file.original_name).replaceAll('"', "")}"`,
    },
  });
}

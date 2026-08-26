import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { readFileStream } from "@/lib/storage";
import { requireStaff } from "@/lib/security";
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

  // Staff sessions must not ride the customer file path: job_files RLS grants
  // staff broad read access, which would let a delivery rider download any
  // customer's document through this customer endpoint. Admins keep access.
  const staff = await requireStaff();
  if (staff && staff.role === "delivery") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
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

  // Proxy the bytes through our own route with an explicit inline
  // disposition — a redirect to Supabase's signed URL leaves the browser
  // relying on Storage's own disposition default, which forces a download
  // instead of an in-tab preview.
  let stream: ReadableStream;
  try {
    stream = await readFileStream(file.storage_path);
  } catch {
    return NextResponse.json({ error: "Stored file missing" }, { status: 404 });
  }
  return new NextResponse(stream, {
    headers: {
      "Content-Type": file.mime_type ?? "application/octet-stream",
      "Content-Length": String(file.size_bytes ?? 0),
      "Content-Disposition": `inline; filename="${String(file.original_name).replaceAll('"', "")}"`,
    },
  });
}

import { NextResponse } from "next/server";
import { readFileStream } from "@/lib/storage";

// TEMP debug route — delete after header investigation.
export async function GET() {
  const stream = await readFileStream("originals/c7e9a1c7-96af-4e06-8f4e-04ee8e3706d4.pdf");
  return new NextResponse(stream, {
    headers: { "Content-Type": "application/pdf" },
  });
}

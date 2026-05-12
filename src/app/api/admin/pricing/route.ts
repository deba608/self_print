import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  const row = getDb().prepare("SELECT * FROM pricing_config WHERE id = 1").get() as Record<string, number>;
  return NextResponse.json({
    bwPerPagePaise: row.bw_per_page_paise,
    colorPerPagePaise: row.color_per_page_paise,
    photoPrintPaise: row.photo_print_paise,
    copyMultiplier: row.copy_multiplier,
    a4Multiplier: row.a4_multiplier,
    legalMultiplier: row.legal_multiplier,
    photoMultiplier: row.photo_multiplier
  });
}

export async function PUT(request: NextRequest) {
  try {
    const unauthorized = await requireAdminResponse();
    if (unauthorized) return unauthorized;
    const body = await request.json();
    const required = ["bwPerPagePaise", "colorPerPagePaise", "photoPrintPaise", "copyMultiplier", "a4Multiplier", "legalMultiplier", "photoMultiplier"];
    for (const key of required) {
      if (typeof body[key] !== "number" || body[key] < 0) {
        return NextResponse.json({ error: `Invalid pricing field: ${key}` }, { status: 400 });
      }
    }
    const now = new Date().toISOString();

    getDb().prepare(`
      UPDATE pricing_config SET
        bw_per_page_paise = ?,
        color_per_page_paise = ?,
        photo_print_paise = ?,
        copy_multiplier = ?,
        a4_multiplier = ?,
        legal_multiplier = ?,
        photo_multiplier = ?,
        updated_at = ?
      WHERE id = 1
    `).run(
      body.bwPerPagePaise,
      body.colorPerPagePaise,
      body.photoPrintPaise,
      body.copyMultiplier,
      body.a4Multiplier,
      body.legalMultiplier,
      body.photoMultiplier,
      now
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
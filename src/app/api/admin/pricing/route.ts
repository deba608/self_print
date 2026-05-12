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
    a3Multiplier: row.a3_multiplier ?? 2.5,
    a4Multiplier: row.a4_multiplier ?? 1,
    a5Multiplier: row.a5_multiplier ?? 0.7,
    a6Multiplier: row.a6_multiplier ?? 0.5,
    b5Multiplier: row.b5_multiplier ?? 0.9,
    legalMultiplier: row.legal_multiplier ?? 1.25,
    photoMultiplier: row.photo_multiplier ?? 1,
    expiryMinutes: row.expiry_minutes ?? 1440
  });
}

export async function PUT(request: NextRequest) {
  try {
    const unauthorized = await requireAdminResponse();
    if (unauthorized) return unauthorized;
    const body = await request.json();
    const required = [
      "bwPerPagePaise", "colorPerPagePaise", "photoPrintPaise", "copyMultiplier",
      "a3Multiplier", "a4Multiplier", "a5Multiplier", "a6Multiplier", "b5Multiplier",
      "legalMultiplier", "photoMultiplier", "expiryMinutes"
    ];
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
        a3_multiplier = ?,
        a4_multiplier = ?,
        a5_multiplier = ?,
        a6_multiplier = ?,
        b5_multiplier = ?,
        legal_multiplier = ?,
        photo_multiplier = ?,
        expiry_minutes = ?,
        updated_at = ?
      WHERE id = 1
    `).run(
      body.bwPerPagePaise,
      body.colorPerPagePaise,
      body.photoPrintPaise,
      body.copyMultiplier,
      body.a3Multiplier,
      body.a4Multiplier,
      body.a5Multiplier,
      body.a6Multiplier,
      body.b5Multiplier,
      body.legalMultiplier,
      body.photoMultiplier,
      body.expiryMinutes,
      now
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}
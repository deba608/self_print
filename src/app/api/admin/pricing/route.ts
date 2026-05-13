import { NextRequest, NextResponse } from "next/server";
import { getDb, getPricing } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  return NextResponse.json(getPricing());
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
      INSERT INTO pricing_config (
        id, bw_per_page_paise, color_per_page_paise, photo_print_paise, copy_multiplier,
        a3_multiplier, a4_multiplier, a5_multiplier, a6_multiplier, b5_multiplier,
        legal_multiplier, photo_multiplier, expiry_minutes, updated_at
      ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        bw_per_page_paise = excluded.bw_per_page_paise,
        color_per_page_paise = excluded.color_per_page_paise,
        photo_print_paise = excluded.photo_print_paise,
        copy_multiplier = excluded.copy_multiplier,
        a3_multiplier = excluded.a3_multiplier,
        a4_multiplier = excluded.a4_multiplier,
        a5_multiplier = excluded.a5_multiplier,
        a6_multiplier = excluded.a6_multiplier,
        b5_multiplier = excluded.b5_multiplier,
        legal_multiplier = excluded.legal_multiplier,
        photo_multiplier = excluded.photo_multiplier,
        expiry_minutes = excluded.expiry_minutes,
        updated_at = excluded.updated_at
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

    return NextResponse.json(getPricing());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}

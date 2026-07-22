import { NextRequest, NextResponse } from "next/server";
import { getPricing, updatePricing } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";

export async function GET() {
  const unauthorized = await requireAdminResponse();
  if (unauthorized) return unauthorized;
  return NextResponse.json(await getPricing());
}

export async function PUT(request: NextRequest) {
  try {
    const unauthorized = await requireAdminResponse();
    if (unauthorized) return unauthorized;
    const body = await request.json();
    const required = [
      "bwPerPagePaise", "colorPerPagePaise", "photoPrintPaise", "copyMultiplier",
      "a3Multiplier", "a4Multiplier", "a5Multiplier", "a6Multiplier", "b5Multiplier",
      "legalMultiplier", "photoMultiplier", "duplexBwPerPagePaise", "expiryMinutes", "deliveryFeePaise"
    ];
    for (const key of required) {
      if (typeof body[key] !== "number" || body[key] < 0) {
        return NextResponse.json({ error: `Invalid pricing field: ${key}` }, { status: 400 });
      }
    }

    await updatePricing({
      bwPerPagePaise: body.bwPerPagePaise,
      colorPerPagePaise: body.colorPerPagePaise,
      photoPrintPaise: body.photoPrintPaise,
      copyMultiplier: body.copyMultiplier,
      a3Multiplier: body.a3Multiplier,
      a4Multiplier: body.a4Multiplier,
      a5Multiplier: body.a5Multiplier,
      a6Multiplier: body.a6Multiplier,
      b5Multiplier: body.b5Multiplier,
      legalMultiplier: body.legalMultiplier,
      photoMultiplier: body.photoMultiplier,
      duplexBwPerPagePaise: body.duplexBwPerPagePaise,
      expiryMinutes: body.expiryMinutes,
      deliveryFeePaise: body.deliveryFeePaise
    });

    return NextResponse.json(await getPricing());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}

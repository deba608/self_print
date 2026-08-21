import { NextRequest, NextResponse } from "next/server";
import { getPricing, updatePricing } from "@/lib/db";
import { requireAdminResponse } from "@/lib/security";
import { validateServiceAreaConfig } from "@/lib/service-area";

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
      "legalMultiplier", "photoMultiplier", "duplexBwPerPagePaise", "spiralBindingPerPagePaise",
      "coverFilePaise", "bondPaperPerPagePaise", "spiralBindingSlab1Paise", "spiralBindingSlab2Paise",
      "spiralBindingSlab3Paise", "spiralBindingSlab4Paise", "spiralBindingSlab5Paise", "expiryMinutes", "deliveryFeePaise",
      "freeDeliveryThresholdPaise"
    ];
    for (const key of required) {
      if (typeof body[key] !== "number" || body[key] < 0) {
        return NextResponse.json({ error: `Invalid pricing field: ${key}` }, { status: 400 });
      }
    }

    const currentPricing = await getPricing();

    let serviceArea = currentPricing.serviceArea;
    if (body.serviceArea !== undefined) {
      const validated = validateServiceAreaConfig(body.serviceArea);
      if ("error" in validated) {
        return NextResponse.json({ error: validated.error }, { status: 400 });
      }
      serviceArea = validated.config;
    }

    const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    let orderOpenTime = currentPricing.orderOpenTime;
    let orderCloseTime = currentPricing.orderCloseTime;
    if (body.orderOpenTime !== undefined || body.orderCloseTime !== undefined) {
      const open = body.orderOpenTime ?? null;
      const close = body.orderCloseTime ?? null;
      if ((open && !timePattern.test(open)) || (close && !timePattern.test(close))) {
        return NextResponse.json({ error: "Order hours must be in HH:MM format." }, { status: 400 });
      }
      if ((open && !close) || (!open && close)) {
        return NextResponse.json({ error: "Set both an opening and closing time, or clear both." }, { status: 400 });
      }
      orderOpenTime = open;
      orderCloseTime = close;
    }
    const acceptingOrders = typeof body.acceptingOrders === "boolean" ? body.acceptingOrders : currentPricing.acceptingOrders;
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
      spiralBindingPerPagePaise: body.spiralBindingPerPagePaise,
      coverFilePaise: body.coverFilePaise,
      bondPaperPerPagePaise: body.bondPaperPerPagePaise,
      spiralBindingSlab1Paise: body.spiralBindingSlab1Paise,
      spiralBindingSlab2Paise: body.spiralBindingSlab2Paise,
      spiralBindingSlab3Paise: body.spiralBindingSlab3Paise,
      spiralBindingSlab4Paise: body.spiralBindingSlab4Paise,
      spiralBindingSlab5Paise: body.spiralBindingSlab5Paise,
      expiryMinutes: body.expiryMinutes,
      deliveryFeePaise: body.deliveryFeePaise,
      freeDeliveryThresholdPaise: body.freeDeliveryThresholdPaise,
      serviceArea,
      acceptingOrders,
      orderOpenTime,
      orderCloseTime
    });

    return NextResponse.json(await getPricing());
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Update failed" }, { status: 400 });
  }
}

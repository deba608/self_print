import { getPricing, updatePricing } from "../src/lib/db";

async function main() {
  const before = await getPricing();
  console.log("before:", before);

  const body: any = {
    bwPerPagePaise: 500,
    colorPerPagePaise: 1000,
    photoPrintPaise: 2000,
    copyMultiplier: 1,
    a3Multiplier: 2,
    a4Multiplier: 1,
    a5Multiplier: 0.7,
    a6Multiplier: 0.5,
    b5Multiplier: 0.8,
    legalMultiplier: 1.1,
    photoMultiplier: 1.5,
    duplexBwPerPagePaise: 300,
    expiryMinutes: 60
    // deliveryFeePaise intentionally omitted, simulating old frontend
  };

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
    deliveryFeePaise: typeof body.deliveryFeePaise === "number" ? body.deliveryFeePaise : (await getPricing()).deliveryFeePaise
  });

  const after = await getPricing();
  console.log("after (no crash, deliveryFeePaise preserved):", after);
  if (after.deliveryFeePaise !== before.deliveryFeePaise) {
    throw new Error("deliveryFeePaise was not preserved!");
  }
  console.log("PASS: NOT NULL constraint not hit, deliveryFeePaise preserved from previous value.");
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});

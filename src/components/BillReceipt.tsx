"use client";

import { useState } from "react";
import { Check, Download, Loader2 } from "lucide-react";

export type BillData = {
  shopName: string;
  token: string;
  queuePosition: number;
  files: Array<{ name: string; pages: number }>;
  settings: {
    printType: string;      // bw | color
    duplex: string;         // simplex | long-edge | short-edge
    paperSize: string;
    copies: number;
    pagesPerSheet: number;
    hasSpiralBinding?: boolean;
    hasCoverFile?: boolean;
    spiralBindingSlabPaise?: number;
    spiralBindingQty?: number;
    coverFilePaise?: number;
    coverFileQty?: number;
  };
  totalPaise: number;
  perPagePaise: number;
  totalPages: number;
  deliveryFeePaise?: number;
  paidVia: "online" | "counter";
  paidAt: string; // ISO
};

function rupees(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
}

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString([], { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function BillReceipt({ bill }: { bill: BillData }) {
  const [saving, setSaving] = useState(false);

  const settingsLine = [
    bill.settings.printType === "bw" ? "Black & White" : "Color",
    bill.settings.duplex === "simplex" ? "Single-sided" : "Double-sided",
    bill.settings.paperSize,
    bill.settings.pagesPerSheet > 1 ? `${bill.settings.pagesPerSheet} pages/sheet` : null,
    bill.settings.hasSpiralBinding ? "Spiral binding" : null,
    bill.settings.hasCoverFile ? "Cover file" : null,
  ].filter(Boolean).join(" · ");

  const spiralTotalPaise =
    bill.settings.spiralBindingSlabPaise != null
      ? bill.settings.spiralBindingSlabPaise * (bill.settings.spiralBindingQty ?? 1)
      : 0;

  async function saveAsImage() {
    setSaving(true);
    try {
      const blob = await renderBillPng(bill);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `bill-${bill.token}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="bill-wrap">
      <div className="bill-card" role="region" aria-label="Payment receipt">
        <div className="bill-head">
          <strong className="bill-shop">{bill.shopName}</strong>
          <span className="bill-paid-badge"><Check size={13} aria-hidden="true" /> PAID</span>
        </div>
        <div className="bill-meta">
          <span>Bill · Token <strong>{bill.token}</strong></span>
          <span>{formatDateTime(bill.paidAt)}</span>
        </div>

        <div className="bill-divider" aria-hidden="true" />

        <div className="bill-files">
          {bill.files.map((f, i) => (
            <div className="bill-file-row" key={i}>
              <span className="bill-file-name">{f.name}</span>
              <span className="bill-file-pages">{f.pages} pg</span>
            </div>
          ))}
        </div>

        <div className="bill-divider" aria-hidden="true" />

        <p className="bill-settings">{settingsLine}</p>
        <div className="bill-line">
          <span>{bill.totalPages} page{bill.totalPages !== 1 ? "s" : ""} × {rupees(bill.perPagePaise)}</span>
        </div>
        {bill.settings.copies > 1 && (
          <div className="bill-line"><span>Copies × {bill.settings.copies}</span></div>
        )}
        {bill.settings.hasSpiralBinding && bill.settings.spiralBindingSlabPaise != null && (
          <div className="bill-line">
            <span>Spiral Binding{(bill.settings.spiralBindingQty ?? 1) > 1 ? ` ×${bill.settings.spiralBindingQty}` : ""}</span>
            <span className="bill-line-right">
              {rupees(bill.settings.spiralBindingSlabPaise)}{(bill.settings.spiralBindingQty ?? 1) > 1 ? ` ×${bill.settings.spiralBindingQty}` : ""} = {rupees(spiralTotalPaise)}
            </span>
          </div>
        )}
        {bill.settings.hasCoverFile && bill.settings.coverFilePaise != null && (
          <div className="bill-line"><span>Cover File{(bill.settings.coverFileQty ?? 1) > 1 ? ` ×${bill.settings.coverFileQty}` : ""}</span><span className="bill-line-right">{rupees(bill.settings.coverFilePaise * (bill.settings.coverFileQty ?? 1))}</span></div>
        )}
        {bill.deliveryFeePaise != null && bill.deliveryFeePaise > 0 && (
          <div className="bill-line"><span>Delivery fee</span><span className="bill-line-right">{rupees(bill.deliveryFeePaise)}</span></div>
        )}
        <div className="bill-total">
          <span>TOTAL</span>
          <strong>{rupees(bill.totalPaise)}</strong>
        </div>

        <div className="bill-divider" aria-hidden="true" />

        <p className="bill-foot-line">{bill.paidVia === "online" ? "Paid online (UPI)" : "Paid at counter"}</p>
        <p className="bill-foot-line">Queue #{bill.queuePosition} · show this to staff to collect</p>
        <p className="bill-thanks">Thank you for printing with us!</p>
      </div>

      <button type="button" className="btn-secondary bill-save-btn" style={{ marginTop: "1.25rem" }} onClick={saveAsImage} disabled={saving}>
        {saving ? <Loader2 size={18} className="spin" aria-hidden="true" /> : <Download size={18} aria-hidden="true" />}
        Save bill as image
      </button>
    </div>
  );
}

// Draws the receipt onto an offscreen canvas at 2x and returns a PNG blob.
// Hand-drawn (no html2canvas dependency) so output is identical on every phone.
async function renderBillPng(bill: BillData): Promise<Blob> {
  const scale = 2;
  const W = 360;
  const pad = 22;
  const lineH = 22;

  const spiralTotalPaise =
    bill.settings.spiralBindingSlabPaise != null
      ? bill.settings.spiralBindingSlabPaise * (bill.settings.spiralBindingQty ?? 1)
      : 0;

  // Height: head(64) + meta(26) + files + settings/breakdown + footer block.
  const filesH = bill.files.length * lineH + 8;
  const addonLines = (bill.settings.hasSpiralBinding && spiralTotalPaise > 0 ? 1 : 0)
    + (bill.settings.hasCoverFile && bill.settings.coverFilePaise != null ? 1 : 0)
    + (bill.deliveryFeePaise != null && bill.deliveryFeePaise > 0 ? 1 : 0);
  const breakdownH = (bill.settings.copies > 1 ? 1 : 0) + addonLines + 2;
  const H = 64 + 26 + 14 + filesH + 14 + breakdownH * lineH + 34 + 14 + 3 * lineH + 30 + pad;

  const canvas = document.createElement("canvas");
  canvas.width = W * scale;
  canvas.height = H * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);

  // Paper
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, W, H);

  let y = pad + 10;
  const left = pad;
  const right = W - pad;

  // Header: shop + PAID
  ctx.fillStyle = "#111827";
  ctx.font = "700 18px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(bill.shopName, left, y);
  ctx.fillStyle = "#0d7a7e";
  ctx.font = "800 13px system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("✓ PAID", right, y);
  y += 24;

  ctx.fillStyle = "#4b5563";
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`Bill · Token ${bill.token}`, left, y);
  ctx.textAlign = "right";
  ctx.fillText(formatDateTime(bill.paidAt), right, y);
  y += 16;

  const divider = () => {
    ctx.strokeStyle = "#e5e7eb";
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();
    ctx.setLineDash([]);
    y += 18;
  };

  divider();

  // Files
  ctx.font = "600 13px system-ui, sans-serif";
  for (const f of bill.files) {
    ctx.fillStyle = "#111827";
    ctx.textAlign = "left";
    const name = f.name.length > 30 ? f.name.slice(0, 29) + "…" : f.name;
    ctx.fillText(name, left, y);
    ctx.fillStyle = "#4b5563";
    ctx.textAlign = "right";
    ctx.fillText(`${f.pages} pg`, right, y);
    y += lineH;
  }
  y += 2;

  divider();

  // Settings + breakdown
  const settingsLine = [
    bill.settings.printType === "bw" ? "Black & White" : "Color",
    bill.settings.duplex === "simplex" ? "Single-sided" : "Double-sided",
    bill.settings.paperSize,
    bill.settings.pagesPerSheet > 1 ? `${bill.settings.pagesPerSheet} pages/sheet` : null,
    bill.settings.hasSpiralBinding ? "Spiral binding" : null,
    bill.settings.hasCoverFile ? "Cover file" : null,
  ].filter(Boolean).join(" · ");
  ctx.fillStyle = "#4b5563";
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(settingsLine, left, y);
  y += lineH;

  ctx.fillText(`${bill.totalPages} page${bill.totalPages !== 1 ? "s" : ""} × ${rupees(bill.perPagePaise)}`, left, y);
  y += lineH;
  if (bill.settings.copies > 1) {
    ctx.fillText(`Copies × ${bill.settings.copies}`, left, y);
    y += lineH;
  }
   if (bill.settings.hasSpiralBinding && bill.settings.spiralBindingSlabPaise != null) {
     ctx.textAlign = "left";
     ctx.fillText("Spiral Binding", left, y);
     ctx.textAlign = "right";
     ctx.fillText(`${rupees(bill.settings.spiralBindingSlabPaise)}${(bill.settings.spiralBindingQty ?? 1) > 1 ? ` ×${bill.settings.spiralBindingQty}` : ""} = ${rupees(spiralTotalPaise)}`, right, y);
     y += lineH;
   }
  if (bill.settings.hasCoverFile && bill.settings.coverFilePaise != null) {
    ctx.textAlign = "left";
    ctx.fillText(`Cover File${(bill.settings.coverFileQty ?? 1) > 1 ? ` A-${bill.settings.coverFileQty}` : ""}`, left, y);
    ctx.textAlign = "right";
    ctx.fillText(rupees(bill.settings.coverFilePaise * (bill.settings.coverFileQty ?? 1)), right, y);
    y += lineH;
  }
  if (bill.deliveryFeePaise != null && bill.deliveryFeePaise > 0) {
    ctx.textAlign = "left";
    ctx.fillText("Delivery fee", left, y);
    ctx.textAlign = "right";
    ctx.fillText(rupees(bill.deliveryFeePaise), right, y);
    y += lineH;
  }

  ctx.fillStyle = "#111827";
  ctx.font = "800 16px system-ui, sans-serif";
  ctx.fillText("TOTAL", left, y + 8);
  ctx.textAlign = "right";
  ctx.fillText(rupees(bill.totalPaise), right, y + 8);
  y += 34;

  divider();

  // Footer
  ctx.fillStyle = "#4b5563";
  ctx.font = "600 12px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(bill.paidVia === "online" ? "Paid online (UPI)" : "Paid at counter", left, y);
  y += lineH;
  ctx.fillText(`Queue #${bill.queuePosition} · show this to staff to collect`, left, y);
  y += lineH;
  ctx.fillStyle = "#0d7a7e";
  ctx.fillText("Thank you for printing with us!", left, y);

  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not create image"))), "image/png");
  });
}

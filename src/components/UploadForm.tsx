"use client";

import { useEffect, useMemo, useState } from "react";
import { UploadCloud } from "lucide-react";

type Pricing = {
  bwPerPagePaise: number;
  colorPerPagePaise: number;
  photoPrintPaise: number;
  copyMultiplier: number;
  a4Multiplier: number;
  legalMultiplier: number;
  photoMultiplier: number;
};

export default function UploadForm() {
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [printType, setPrintType] = useState("bw");
  const [copies, setCopies] = useState(1);
  const [pageRange, setPageRange] = useState("");
  const [paperSize, setPaperSize] = useState("A4");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ token: string; pricePaise: number; needsConversion: boolean } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/pricing")
      .then((res) => res.json())
      .then(setPricing)
      .catch(() => {});
  }, []);

  const estimate = useMemo(() => {
    if (!pricing) return 0;
    const pages = pageRange.trim() ? estimateRange(pageRange) : 1;
    if (paperSize === "Photo") return (pricing.photoPrintPaise / 100) * copies * pricing.photoMultiplier;
    const base = printType === "bw" ? pricing.bwPerPagePaise : pricing.colorPerPagePaise;
    const paperMultiplier = paperSize === "Legal" ? pricing.legalMultiplier : pricing.a4Multiplier;
    return Math.round((base / 100) * pages * copies * paperMultiplier * pricing.copyMultiplier);
  }, [copies, pageRange, paperSize, printType, pricing]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (!file) {
      setError("Please choose a file.");
      return;
    }
    setBusy(true);
    const form = new FormData();
    form.set("file", file);
    form.set("printType", printType);
    form.set("copies", String(copies));
    form.set("pageRange", pageRange);
    form.set("paperSize", paperSize);
    const response = await fetch("/api/jobs", { method: "POST", body: form });
    const body = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(body.error ?? "Upload failed");
      return;
    }
    setResult(body);
  }

  if (result) {
    return (
      <div className="stack">
        <p className="muted">Your token number is</p>
        <div className="token">{result.token}</div>
        <p className="price">₹{(result.pricePaise / 100).toFixed(2)}</p>
        <p className="muted">
          {result.needsConversion
            ? "This document needs conversion. Please show this token at the counter."
            : "Please show this token and pay at the counter. Staff will release the print."}
        </p>
        <button className="secondary" onClick={() => window.location.reload()}>Upload another file</button>
      </div>
    );
  }

  return (
    <form className="stack" onSubmit={submit}>
      <label>
        File
        <input type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
      </label>
      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <label>
          Print type
          <select value={printType} onChange={(event) => setPrintType(event.target.value)}>
            <option value="bw">Black & white</option>
            <option value="color">Color</option>
          </select>
        </label>
        <label>
          Copies
          <input type="number" min="1" max="99" value={copies} onChange={(event) => setCopies(Number(event.target.value))} />
        </label>
      </div>
      <label>
        Page range
        <input placeholder="All pages or 1-3,5" value={pageRange} onChange={(event) => setPageRange(event.target.value)} />
      </label>
      <label>
        Paper size
        <select value={paperSize} onChange={(event) => setPaperSize(event.target.value)}>
          <option>A4</option>
          <option>Legal</option>
          <option>Photo</option>
        </select>
      </label>
      <div className="panel stack" style={{ background: "#eef7f5" }}>
        <span className="muted">Estimated price</span>
        <strong className="price">₹{estimate.toFixed(2)}</strong>
      </div>
      {error ? <p style={{ color: "var(--danger)" }}>{error}</p> : null}
      <button disabled={busy}>
        <UploadCloud size={18} />
        {busy ? "Submitting..." : "Submit print job"}
      </button>
    </form>
  );
}

function estimateRange(value: string) {
  const pages = new Set<number>();
  for (const part of value.split(",")) {
    const [startRaw, endRaw] = part.trim().split("-");
    const start = Number(startRaw);
    const end = Number(endRaw ?? startRaw);
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) continue;
    for (let page = start; page <= end; page += 1) pages.add(page);
  }
  return Math.max(pages.size, 1);
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Clock, Loader2, X, Zap } from "lucide-react";
import type { PricingConfig as Pricing } from "@/lib/types";
import { calculatePrice } from "@/lib/pricing";

type NumericPricing = Omit<Pricing, "serviceArea">;
type PricingDraft = {
  [Key in keyof NumericPricing]: NumericPricing[Key] | "";
};

const defaultPricing: NumericPricing = {
  bwPerPagePaise: 200,
  colorPerPagePaise: 800,
  photoPrintPaise: 1000,
  copyMultiplier: 1,
  a3Multiplier: 2,
  a4Multiplier: 1,
  a5Multiplier: 0.75,
  a6Multiplier: 0.5,
  b5Multiplier: 0.9,
  legalMultiplier: 1.25,
  photoMultiplier: 1.5,
  duplexBwPerPagePaise: 100,
  spiralBindingPerPagePaise: 150,
  coverFilePaise: 1000,
  bondPaperPerPagePaise: 100,
  spiralBindingSlab1Paise: 2000,
  spiralBindingSlab2Paise: 2500,
  spiralBindingSlab3Paise: 3000,
  spiralBindingSlab4Paise: 4000,
  spiralBindingSlab5Paise: 5000,
  expiryMinutes: 1440,
  deliveryFeePaise: 0,
};

// Strip non-numeric extras (e.g. serviceArea) off the incoming pricing
// object — the draft must contain exactly the numeric fields, or the
// fill-every-value check below trips on an object-valued key.
function toDraft(pricing: NumericPricing & Record<string, unknown>): PricingDraft {
  const draft = {} as Record<string, number | "">;
  for (const key of Object.keys(defaultPricing) as Array<keyof NumericPricing>) {
    const value = pricing[key];
    const fallback = defaultPricing[key];
    draft[key] = typeof value === "number" && Number.isFinite(value) ? value : typeof fallback === "number" ? fallback : "";
  }
  return draft as PricingDraft;
}

function normalizePricingDraft(draft: PricingDraft): NumericPricing | null {
  const entries = Object.entries(draft) as Array<[keyof NumericPricing, number | ""]>;
  if (entries.some(([, value]) => value === "" || !Number.isFinite(value))) {
    return null;
  }

  return Object.fromEntries(entries) as NumericPricing;
}

function formatPaiseInput(value: number | "") {
  return value === "" ? "" : String(value / 100);
}

function rupees(paise: number) {
  return `₹${(paise / 100).toFixed(2)}`;
}

// Every money field is the same shape — label, ₹-prefixed number input, and an
// optional hint. Inlining it a dozen times was how the delivery fee ended up
// as the one input missing its currency prefix.
function PriceField({
  label,
  value,
  onChange,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  const id = `price-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}`;
  return (
    <div className="pricing-field">
      <label htmlFor={id}>{label}</label>
      <div className="price-input">
        <span className="currency">₹</span>
        <input
          id={id}
          type="number"
          step="0.01"
          min="0"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
      {hint && <span className="pricing-hint">{hint}</span>}
    </div>
  );
}

export default function PricingPanel({
  pricing,
  onSave,
  onClose
}: {
  pricing: Pricing | null;
  onSave: (data: NumericPricing) => Promise<void>;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState<PricingDraft>(toDraft(pricing || defaultPricing));
  const [priceInputs, setPriceInputs] = useState({
    bwPerPagePaise: formatPaiseInput((pricing || defaultPricing).bwPerPagePaise),
    colorPerPagePaise: formatPaiseInput((pricing || defaultPricing).colorPerPagePaise),
    photoPrintPaise: formatPaiseInput((pricing || defaultPricing).photoPrintPaise),
    duplexBwPerPagePaise: formatPaiseInput((pricing || defaultPricing).duplexBwPerPagePaise),
    spiralBindingPerPagePaise: formatPaiseInput((pricing || defaultPricing).spiralBindingPerPagePaise),
    coverFilePaise: formatPaiseInput((pricing || defaultPricing).coverFilePaise),
    deliveryFeePaise: formatPaiseInput((pricing || defaultPricing).deliveryFeePaise),
    bondPaperPerPagePaise: formatPaiseInput((pricing || defaultPricing).bondPaperPerPagePaise),
    spiralBindingSlab1Paise: formatPaiseInput((pricing || defaultPricing).spiralBindingSlab1Paise),
    spiralBindingSlab2Paise: formatPaiseInput((pricing || defaultPricing).spiralBindingSlab2Paise),
    spiralBindingSlab3Paise: formatPaiseInput((pricing || defaultPricing).spiralBindingSlab3Paise),
    spiralBindingSlab4Paise: formatPaiseInput((pricing || defaultPricing).spiralBindingSlab4Paise),
    spiralBindingSlab5Paise: formatPaiseInput((pricing || defaultPricing).spiralBindingSlab5Paise),
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const nextPricing = pricing || defaultPricing;
    setFormData(toDraft(nextPricing));
    setPriceInputs({
      bwPerPagePaise: formatPaiseInput(nextPricing.bwPerPagePaise),
      colorPerPagePaise: formatPaiseInput(nextPricing.colorPerPagePaise),
      photoPrintPaise: formatPaiseInput(nextPricing.photoPrintPaise),
      duplexBwPerPagePaise: formatPaiseInput(nextPricing.duplexBwPerPagePaise),
      spiralBindingPerPagePaise: formatPaiseInput(nextPricing.spiralBindingPerPagePaise),
      coverFilePaise: formatPaiseInput(nextPricing.coverFilePaise),
      deliveryFeePaise: formatPaiseInput(nextPricing.deliveryFeePaise),
      bondPaperPerPagePaise: formatPaiseInput(nextPricing.bondPaperPerPagePaise),
      spiralBindingSlab1Paise: formatPaiseInput(nextPricing.spiralBindingSlab1Paise),
      spiralBindingSlab2Paise: formatPaiseInput(nextPricing.spiralBindingSlab2Paise),
      spiralBindingSlab3Paise: formatPaiseInput(nextPricing.spiralBindingSlab3Paise),
      spiralBindingSlab4Paise: formatPaiseInput(nextPricing.spiralBindingSlab4Paise),
      spiralBindingSlab5Paise: formatPaiseInput(nextPricing.spiralBindingSlab5Paise),
    });
  }, [pricing]);

  const updateField = (field: keyof NumericPricing, value: string, transform: (value: string) => number = Number) => {
    if (value === "") {
      setFormData(prev => ({ ...prev, [field]: "" }));
    } else {
      const num = transform(value);
      setFormData(prev => ({ ...prev, [field]: num }));
    }
    setSaved(false);
    setError("");
  };

  const updatePriceField = (field: "bwPerPagePaise" | "colorPerPagePaise" | "photoPrintPaise" | "duplexBwPerPagePaise" | "spiralBindingPerPagePaise" | "coverFilePaise" | "deliveryFeePaise" | "bondPaperPerPagePaise" | "spiralBindingSlab1Paise" | "spiralBindingSlab2Paise" | "spiralBindingSlab3Paise" | "spiralBindingSlab4Paise" | "spiralBindingSlab5Paise", rawValue: string) => {
    setPriceInputs(prev => ({ ...prev, [field]: rawValue }));
    if (rawValue === "") {
      setFormData(prev => ({ ...prev, [field]: "" }));
    } else {
      const num = Number(rawValue);
      setFormData(prev => ({ ...prev, [field]: Number.isFinite(num) ? Math.round(num * 100) : "" }));
    }
    setSaved(false);
    setError("");
  };

  // Live cost of a representative job, recomputed as fields are edited. Raw
  // per-page paise say little on their own — this shows what the change
  // actually does to a real order before it's saved.
  const sample = useMemo(() => {
    const draft = normalizePricingDraft(formData);
    if (!draft) return null;
    const config = { ...draft, serviceArea: pricing?.serviceArea } as Pricing;
    try {
      const bw = calculatePrice({
        printType: "bw", copies: 1, pageRange: null, paperSize: "A4",
        pageCount: 10, pricing: config, duplex: "simplex", pagesPerSheet: 1,
      });
      const color = calculatePrice({
        printType: "color", copies: 1, pageRange: null, paperSize: "A4",
        pageCount: 10, pricing: config, duplex: "simplex", pagesPerSheet: 1,
      });
      return { bw, color };
    } catch {
      return null;
    }
  }, [formData, pricing]);

  // Effective per-page cost once a paper multiplier is applied, so "A3 × 2"
  // reads as a price instead of an abstract factor.
  const effectivePerPage = (multiplier: number | "") => {
    const base = formData.bwPerPagePaise;
    if (typeof base !== "number" || typeof multiplier !== "number") return null;
    return Math.round(base * multiplier);
  };

  const handleSave = async () => {
    const nextPricing = normalizePricingDraft(formData);
    if (!nextPricing) {
      setError("Fill every pricing value before saving.");
      return;
    }

    setSaving(true);
    try {
      await onSave(nextPricing);
      setSaved(true);
      setTimeout(() => {
        setSaved(false);
        onClose();
      }, 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save pricing.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="pricing-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Zap size={20} className="panel-icon" />
            <h2>Pricing Settings</h2>
          </div>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="pricing-sections">
          {/* Anchors every edit below to a concrete outcome. */}
          <div className="pricing-preview" aria-live="polite">
            <span className="pricing-preview-label">Sample 10-page A4 job</span>
            <div className="pricing-preview-values">
              <span className="pricing-preview-chip">
                B&W <strong>{sample ? rupees(sample.bw) : "—"}</strong>
              </span>
              <span className="pricing-preview-chip">
                Color <strong>{sample ? rupees(sample.color) : "—"}</strong>
              </span>
            </div>
          </div>

          <section className="pricing-section">
            <h3>Base print prices</h3>
            <div className="pricing-grid">
              <PriceField
                label="B&W per page"
                value={priceInputs.bwPerPagePaise}
                onChange={(v) => updatePriceField("bwPerPagePaise", v)}
              />
              <PriceField
                label="Color per page"
                value={priceInputs.colorPerPagePaise}
                onChange={(v) => updatePriceField("colorPerPagePaise", v)}
              />
              <PriceField
                label="Double-sided B&W per page"
                value={priceInputs.duplexBwPerPagePaise}
                onChange={(v) => updatePriceField("duplexBwPerPagePaise", v)}
                hint="Per side, when the customer picks double-sided."
              />
              <PriceField
                label="Photo print"
                value={priceInputs.photoPrintPaise}
                onChange={(v) => updatePriceField("photoPrintPaise", v)}
                hint="Flat per photo — replaces per-page pricing."
              />
            </div>
          </section>

          <section className="pricing-section">
            <h3>Add-ons</h3>
            <div className="pricing-grid">
              <PriceField
                label="Bond paper per page"
                value={priceInputs.bondPaperPerPagePaise}
                onChange={(v) => updatePriceField("bondPaperPerPagePaise", v)}
                hint="Charged on every page of the job."
              />
              <PriceField
                label="Cover file"
                value={priceInputs.coverFilePaise}
                onChange={(v) => updatePriceField("coverFilePaise", v)}
                hint="Flat, multiplied by the chosen quantity."
              />
            </div>
          </section>

          <section className="pricing-section">
            <h3>Spiral binding</h3>
            <p className="pricing-section-note">
              Flat price by page count — the job falls into one band, not a per-page rate.
            </p>
            <div className="slab-ladder">
              {([
                ["0–70", "spiralBindingSlab1Paise"],
                ["71–100", "spiralBindingSlab2Paise"],
                ["101–150", "spiralBindingSlab3Paise"],
                ["151–200", "spiralBindingSlab4Paise"],
                ["200+", "spiralBindingSlab5Paise"],
              ] as const).map(([range, field]) => (
                <div className="slab-row" key={field}>
                  <label className="slab-range" htmlFor={field}>
                    {range} <span>pages</span>
                  </label>
                  <div className="price-input">
                    <span className="currency">₹</span>
                    <input
                      id={field}
                      type="number"
                      step="0.01"
                      min="0"
                      value={priceInputs[field]}
                      onChange={(e) => updatePriceField(field, e.target.value)}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="pricing-section">
            <h3>Paper size multipliers</h3>
            <p className="pricing-section-note">
              Scales the per-page rate. Each shows the resulting B&W price.
            </p>
            <div className="pricing-grid mult-grid">
              {([
                ["A3", "a3Multiplier"],
                ["A4", "a4Multiplier"],
                ["A5", "a5Multiplier"],
                ["A6", "a6Multiplier"],
                ["B5", "b5Multiplier"],
                ["Legal", "legalMultiplier"],
                ["Photo", "photoMultiplier"],
                ["Per copy", "copyMultiplier"],
              ] as const).map(([label, field]) => {
                const effective = effectivePerPage(formData[field]);
                return (
                  <div className="pricing-field mult-field" key={field}>
                    <label htmlFor={field}>{label}</label>
                    <div className="mult-input">
                      <span className="mult-sign">×</span>
                      <input
                        id={field}
                        type="number"
                        step="0.05"
                        min="0"
                        value={formData[field]}
                        onChange={(e) => updateField(field, e.target.value)}
                      />
                    </div>
                    <span className="mult-effect">
                      {effective !== null ? `${rupees(effective)}/pg` : "—"}
                    </span>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="pricing-section">
            <h3>Delivery &amp; expiry</h3>
            <div className="pricing-grid">
              <PriceField
                label="Home delivery fee"
                value={priceInputs.deliveryFeePaise}
                onChange={(v) => updatePriceField("deliveryFeePaise", v)}
                hint="Added once per delivery order."
              />
              <div className="pricing-field">
                <label htmlFor="expiryMinutes">Expire unpaid jobs after</label>
                <div className="time-input">
                  <Clock size={16} className="time-icon" />
                  <input
                    id="expiryMinutes"
                    type="number"
                    step="1"
                    min="1"
                    value={formData.expiryMinutes}
                    onChange={(e) => updateField("expiryMinutes", e.target.value, (v) => Math.round(Number(v)))}
                  />
                  <span className="time-hint">min</span>
                </div>
                <span className="pricing-hint">
                  {typeof formData.expiryMinutes === "number" && formData.expiryMinutes > 0
                    ? `${(formData.expiryMinutes / 60).toFixed(1)} hours in the queue before removal`
                    : ""}
                </span>
              </div>
            </div>
          </section>

        </div>

        {error && <p className="panel-error" role="alert">{error}</p>}

        <div className="panel-footer">
          <button type="button" className="btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="btn-primary" onClick={handleSave} disabled={saved || saving}>
            {saving ? (
              <>
                <Loader2 size={18} className="spin" />
                Saving...
              </>
            ) : saved ? (
              <>
                <Check size={18} />
                Saved!
              </>
            ) : (
              <>
                Save Changes
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

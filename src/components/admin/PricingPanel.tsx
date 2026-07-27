"use client";

import { useEffect, useState } from "react";
import { Check, Clock, Loader2, X, Zap } from "lucide-react";
import type { PricingConfig as Pricing } from "@/lib/types";

type PricingDraft = {
  [Key in keyof Pricing]: Pricing[Key] | "";
};

const defaultPricing: Pricing = {
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
  expiryMinutes: 1440,
  deliveryFeePaise: 0,
};

function normalizePricingDraft(draft: PricingDraft): Pricing | null {
  const entries = Object.entries(draft) as Array<[keyof Pricing, number | ""]>;
  if (entries.some(([, value]) => value === "" || !Number.isFinite(value))) {
    return null;
  }

  return Object.fromEntries(entries) as Pricing;
}

function formatPaiseInput(value: number | "") {
  return value === "" ? "" : String(value / 100);
}

export default function PricingPanel({
  pricing,
  onSave,
  onClose
}: {
  pricing: Pricing | null;
  onSave: (data: Pricing) => Promise<void>;
  onClose: () => void;
}) {
  const [formData, setFormData] = useState<PricingDraft>(pricing || defaultPricing);
  const [priceInputs, setPriceInputs] = useState({
    bwPerPagePaise: formatPaiseInput((pricing || defaultPricing).bwPerPagePaise),
    colorPerPagePaise: formatPaiseInput((pricing || defaultPricing).colorPerPagePaise),
    photoPrintPaise: formatPaiseInput((pricing || defaultPricing).photoPrintPaise),
    duplexBwPerPagePaise: formatPaiseInput((pricing || defaultPricing).duplexBwPerPagePaise),
    deliveryFeePaise: formatPaiseInput((pricing || defaultPricing).deliveryFeePaise),
  });
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const nextPricing = pricing || defaultPricing;
    setFormData(nextPricing);
    setPriceInputs({
      bwPerPagePaise: formatPaiseInput(nextPricing.bwPerPagePaise),
      colorPerPagePaise: formatPaiseInput(nextPricing.colorPerPagePaise),
      photoPrintPaise: formatPaiseInput(nextPricing.photoPrintPaise),
      duplexBwPerPagePaise: formatPaiseInput(nextPricing.duplexBwPerPagePaise),
      deliveryFeePaise: formatPaiseInput(nextPricing.deliveryFeePaise),
    });
  }, [pricing]);

  const updateField = (field: keyof Pricing, value: string, transform: (value: string) => number = Number) => {
    if (value === "") {
      setFormData(prev => ({ ...prev, [field]: "" }));
    } else {
      const num = transform(value);
      setFormData(prev => ({ ...prev, [field]: num }));
    }
    setSaved(false);
    setError("");
  };

  const updatePriceField = (field: "bwPerPagePaise" | "colorPerPagePaise" | "photoPrintPaise" | "duplexBwPerPagePaise" | "deliveryFeePaise", rawValue: string) => {
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
          <section className="pricing-section">
            <h3>Base Print Prices</h3>
            <div className="pricing-grid">
              <div className="pricing-field">
                <label>B&amp;W per page</label>
                <div className="price-input">
                  <span className="currency">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceInputs.bwPerPagePaise}
                    onChange={(e) => updatePriceField("bwPerPagePaise", e.target.value)}
                  />
                </div>
              </div>
              <div className="pricing-field">
                <label>Color per page</label>
                <div className="price-input">
                  <span className="currency">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceInputs.colorPerPagePaise}
                    onChange={(e) => updatePriceField("colorPerPagePaise", e.target.value)}
                  />
                </div>
              </div>
              <div className="pricing-field">
                <label>Photo print</label>
                <div className="price-input">
                  <span className="currency">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceInputs.photoPrintPaise}
                    onChange={(e) => updatePriceField("photoPrintPaise", e.target.value)}
                  />
                </div>
              </div>
              <div className="pricing-field">
                <label>Double-sided B&amp;W per page</label>
                <div className="price-input">
                  <span className="currency">₹</span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={priceInputs.duplexBwPerPagePaise}
                    onChange={(e) => updatePriceField("duplexBwPerPagePaise", e.target.value)}
                  />
                </div>
              </div>
              <div className="pricing-field">
                <label>Delivery Fee (flat, ₹)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={priceInputs.deliveryFeePaise}
                  onChange={(e) => updatePriceField("deliveryFeePaise", e.target.value)}
                />
                <span className="pricing-hint">Added once per home-delivery order, on top of the print cost.</span>
              </div>
            </div>
          </section>

          <section className="pricing-section">
            <h3>Multipliers</h3>
            <div className="pricing-grid">
              <div className="pricing-field">
                <label>Copy multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.copyMultiplier}
                  onChange={(e) => updateField("copyMultiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>A3 multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.a3Multiplier}
                  onChange={(e) => updateField("a3Multiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>A4 multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.a4Multiplier}
                  onChange={(e) => updateField("a4Multiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>A5 multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.a5Multiplier}
                  onChange={(e) => updateField("a5Multiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>Legal multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.legalMultiplier}
                  onChange={(e) => updateField("legalMultiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>A6 multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.a6Multiplier}
                  onChange={(e) => updateField("a6Multiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>B5 multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.b5Multiplier}
                  onChange={(e) => updateField("b5Multiplier", e.target.value)}
                />
              </div>
              <div className="pricing-field">
                <label>Photo multiplier</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={formData.photoMultiplier}
                  onChange={(e) => updateField("photoMultiplier", e.target.value)}
                />
              </div>
            </div>
          </section>

          <section className="pricing-section">
            <h3>Job Expiry</h3>
            <div className="pricing-grid single">
              <div className="pricing-field">
                <label>Expire unpaid jobs after</label>
                <div className="time-input">
                  <Clock size={16} className="time-icon" />
                  <input
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
                    ? `${(formData.expiryMinutes / 60).toFixed(1)} hours before an unpaid, unreleased job is removed from the queue`
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

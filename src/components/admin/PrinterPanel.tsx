"use client";

import { useState } from "react";
import { Check, Monitor, Printer, X } from "lucide-react";
import type { PrinterOption } from "@/lib/types";

export default function PrinterPanel({
  mode,
  printers,
  selectedPrinter,
  onSelect,
  onClose
}: {
  mode: "bw" | "color";
  printers: PrinterOption[];
  selectedPrinter: string;
  onSelect: (name: string) => void;
  onClose: () => void;
}) {
  const [manualPrinter, setManualPrinter] = useState(selectedPrinter);
  const modeLabel = mode === "color" ? "Color" : "B/W";

  const saveManualPrinter = () => {
    const printerName = manualPrinter.trim();
    if (!printerName) return;
    onSelect(printerName);
    onClose();
  };

  return (
    <div className="panel-overlay" onClick={onClose}>
      <div className="printer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header">
          <div className="panel-title">
            <Monitor size={20} className="panel-icon" />
            <h2>Select {modeLabel} Printer</h2>
          </div>
          <button type="button" className="panel-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="printer-list">
          {printers.length === 0 ? (
            <>
              <div className="printer-empty">
                <Printer size={40} strokeWidth={1} />
                <p>No printers detected</p>
                <span>Make sure the print agent is running on the shop computer.</span>
              </div>
              <div className="manual-printer-entry">
                <label htmlFor="manual-printer">Set printer name manually</label>
                <div className="manual-printer-row">
                  <input
                    id="manual-printer"
                    value={manualPrinter}
                    onChange={(event) => setManualPrinter(event.target.value)}
                    placeholder="Example: HP LaserJet Pro"
                  />
                  <button type="button" onClick={saveManualPrinter} disabled={!manualPrinter.trim()}>
                    Set
                  </button>
                </div>
              </div>
            </>
          ) : (
            printers.map((printer) => (
              <button
                type="button"
                key={printer.name}
                className={`printer-item ${selectedPrinter === printer.name ? "selected" : ""}`}
                onClick={() => {
                  onSelect(printer.name);
                  onClose();
                }}
              >
                <div className="printer-icon">
                  <Printer size={20} />
                </div>
                <div className="printer-info">
                  <span className="printer-name">{printer.name}</span>
                  <span className="printer-driver">{printer.driverName}</span>
                </div>
                {!printer.canDuplex && <span className="no-duplex-tag" title="Can't print double-sided">No Duplex</span>}
                {printer.isDefault && <span className="default-tag">Default</span>}
                {selectedPrinter === printer.name && (
                  <div className="printer-check">
                    <Check size={16} />
                  </div>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

"use client";

import {
  Bell, BellRing, ChevronDown, Clock, LogOut, Loader2, Menu, Printer, RefreshCw, Settings,
} from "lucide-react";
import ManageMenu from "./ManageMenu";
import TopbarMoreMenu from "./TopbarMoreMenu";
import AgentUpdateBadge from "./AgentUpdateBadge";

export default function AdminTopbar({
  bwPrinterName,
  colorPrinterName,
  newJobCount,
  soundOn,
  onToggleSound,
  onRefresh,
  onOpenPricing,
  onOpenHours,
  onOpenPrinter,
  onLogout,
  loggingOut,
  staffName,
  showPricing,
  showHours,
  onToggleSidebar,
  isSuperAdmin,
}: {
  bwPrinterName: string;
  colorPrinterName: string;
  newJobCount: number;
  soundOn: boolean;
  onToggleSound: () => void;
  onRefresh: () => void;
  onOpenPricing: () => void;
  onOpenHours: () => void;
  onOpenPrinter: (mode: "bw" | "color") => void;
  onLogout: () => Promise<void>;
  loggingOut: boolean;
  staffName?: string;
  showPricing: boolean;
  showHours: boolean;
  onToggleSidebar?: () => void;
  isSuperAdmin?: boolean;
}) {
  return (
    <header className="admin-topbar">
      <div className="admin-topbar-inner">
        {onToggleSidebar && (
          <button type="button" className="sidebar-toggle-btn" onClick={onToggleSidebar} aria-label="Toggle navigation menu">
            <Menu size={20} />
          </button>
        )}
        <div className="topbar-brand">
          <div className="brand-logo">
            <Printer size={24} strokeWidth={1.5} />
          </div>
          <div className="brand-text">
            <span className="brand-name">SelfPrint</span>
            <span className="brand-tag">Admin</span>
          </div>
        </div>

        <button
          className={`printer-btn ${bwPrinterName ? "active" : "empty"}`}
          onClick={() => onOpenPrinter("bw")}
          type="button"
          aria-label={bwPrinterName ? `Selected B/W printer ${bwPrinterName}` : "Select B/W printer"}
        >
          <Printer size={18} />
          <span className="printer-label">B/W: {bwPrinterName || "Select Printer"}</span>
          {bwPrinterName && <span className="printer-dot"></span>}
          <ChevronDown size={16} className="chevron" />
        </button>

        <button
          className={`printer-btn ${colorPrinterName ? "active" : "empty"}`}
          onClick={() => onOpenPrinter("color")}
          type="button"
          aria-label={colorPrinterName ? `Selected color printer ${colorPrinterName}` : "Select color printer"}
        >
          <Printer size={18} />
          <span className="printer-label">Color: {colorPrinterName || "Select Printer"}</span>
          {colorPrinterName && <span className="printer-dot"></span>}
          <ChevronDown size={16} className="chevron" />
        </button>

        <div className="topbar-actions">
          <div className="action-group">
            <button
              type="button"
              className={`action-btn action-btn-labeled notification ${soundOn ? "chime-on" : ""} ${newJobCount > 0 ? "has-new" : ""}`}
              onClick={() => {
                if (newJobCount > 0) onRefresh();
                onToggleSound();
              }}
              title={`Notifications: ${newJobCount} new orders. Chime alert is ${soundOn ? "ON" : "OFF"}. Click to ${newJobCount > 0 ? "refresh & " : ""}toggle chime sound.`}
              aria-label="Notifications and chime alert settings"
            >
              {soundOn ? <BellRing size={18} className="bell-ring-icon" /> : <Bell size={18} />}
              {newJobCount > 0 && (
                <span className="notif-badge">{newJobCount}</span>
              )}
              {soundOn && <span className="chime-dot" title="New-order chime active"></span>}
              <span>Alerts</span>
            </button>

            <button type="button" className="action-btn action-btn-labeled" onClick={onRefresh} title="Refresh" aria-label="Refresh jobs">
              <RefreshCw size={18} />
              <span>Refresh</span>
            </button>


            <ManageMenu />
            {isSuperAdmin && <AgentUpdateBadge />}

            <button
              type="button"
              className={`action-btn action-btn-labeled ${showPricing ? "active" : ""}`}
              onClick={onOpenPricing}
              title="Pricing Settings"
              aria-label="Pricing settings"
            >
              <Settings size={18} />
              <span>Pricing</span>
            </button>

            <button
              type="button"
              className={`action-btn action-btn-labeled ${showHours ? "active" : ""}`}
              onClick={onOpenHours}
              title="Service Hours"
              aria-label="Service hours settings"
            >
              <Clock size={18} />
              <span>Hours</span>
            </button>
          </div>

          <TopbarMoreMenu
            newJobCount={newJobCount}
            soundOn={soundOn}
            onToggleSound={onToggleSound}
            onRefresh={onRefresh}
            onOpenPricing={onOpenPricing}
            showPricing={showPricing}
            onOpenHours={onOpenHours}
            showHours={showHours}
          />

          <div className="topbar-divider" aria-hidden="true" />

          <div className="action-group">
            <button
              type="button"
              className="action-btn danger logout-action"
              onClick={onLogout}
              title={staffName ? `Log out ${staffName}` : "Log out"}
              aria-label={staffName ? `Log out ${staffName}` : "Log out"}
              disabled={loggingOut}
            >
              {loggingOut ? (
                <Loader2 size={18} className="spin" aria-hidden="true" />
              ) : (
                <LogOut size={18} aria-hidden="true" />
              )}
              <span className="logout-label">{loggingOut ? "Signing out..." : "Log out"}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}

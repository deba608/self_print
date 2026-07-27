"use client";

import {
  Bell, BellRing, ChevronDown, Inbox, LogOut, Loader2, Menu, Monitor, Printer, RefreshCw, Settings,
} from "lucide-react";
import ManageMenu from "./ManageMenu";

export default function AdminTopbar({
  printerName,
  newJobCount,
  soundOn,
  onToggleSound,
  onRefresh,
  onOpenPricing,
  onOpenPrinter,
  onOpenManageOrders,
  onLogout,
  loggingOut,
  staffName,
  showPricing,
  onToggleSidebar,
  filterBar,
}: {
  printerName: string;
  newJobCount: number;
  soundOn: boolean;
  onToggleSound: () => void;
  onRefresh: () => void;
  onOpenPricing: () => void;
  onOpenPrinter: () => void;
  onOpenManageOrders: () => void;
  onLogout: () => Promise<void>;
  loggingOut: boolean;
  staffName?: string;
  showPricing: boolean;
  onToggleSidebar?: () => void;
  filterBar?: React.ReactNode;
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

        {filterBar && (
          <div className="topbar-filter-bar">
            {filterBar}
          </div>
        )}

        <button
          className={`printer-btn ${printerName ? "active" : "empty"}`}
          onClick={onOpenPrinter}
          type="button"
          aria-label={printerName ? `Selected printer ${printerName}` : "Select printer"}
        >
          <Monitor size={18} />
          <span className="printer-label">{printerName || "Select Printer"}</span>
          {printerName && <span className="printer-dot"></span>}
          <ChevronDown size={16} className="chevron" />
        </button>

        <div className="topbar-actions">
          <div className="action-group">
            <button
              type="button"
              className={`action-btn notification ${soundOn ? "chime-on" : ""} ${newJobCount > 0 ? "has-new" : ""}`}
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
            </button>

            <button type="button" className="action-btn" onClick={onRefresh} title="Refresh" aria-label="Refresh jobs">
              <RefreshCw size={18} />
            </button>

            <button
              type="button"
              className="action-btn"
              onClick={onOpenManageOrders}
              title="Cleanup: select and delete old orders"
              aria-label="Cleanup orders"
            >
              <Inbox size={18} />
            </button>
          </div>

          <div className="topbar-divider" aria-hidden="true" />

          <div className="action-group">
            <ManageMenu />

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
          </div>

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

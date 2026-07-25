"use client";

import { useState, type ReactNode } from "react";
import { Printer, Eye, EyeOff, ArrowRight, Loader2, AlertCircle, type LucideIcon } from "lucide-react";

/**
 * Shared building blocks for every auth screen (/login, /admin,
 * /register, /forgot-password, /reset-password, /staff/accept-invite).
 * All markup/classes match the existing login-* styles in globals.css.
 */

export function AuthShell({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return (
    <main className="admin-login-shell">
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <div className="login-logo">
              <Printer size={32} strokeWidth={1.5} />
            </div>
            <h1>{title}</h1>
            {subtitle && <p className="login-subtitle">{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
    </main>
  );
}

type AuthInputProps = {
  id: string;
  label: string;
  icon: LucideIcon;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "text" | "tel" | "email" | "numeric";
  disabled?: boolean;
  autoFocus?: boolean;
  required?: boolean;
  /** Renders a show/hide toggle and masks input. Overrides `type`. */
  password?: boolean;
  /** Renders next to the label, right-aligned (e.g. a "Forgot password?" link). */
  labelAction?: ReactNode;
};

export function AuthInput({
  id,
  label,
  icon: Icon,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
  disabled,
  autoFocus,
  required,
  password,
  labelAction,
}: AuthInputProps) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-group">
      <div className="input-label-row">
        <label htmlFor={id}>{label}</label>
        {labelAction}
      </div>
      <div className="input-wrapper">
        <span className="input-icon">
          <Icon size={18} strokeWidth={2} />
        </span>
        <input
          id={id}
          type={password ? (show ? "text" : "password") : type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          disabled={disabled}
          autoFocus={autoFocus}
          required={required}
        />
        {password && (
          <button
            type="button"
            className="password-toggle"
            onClick={() => setShow(!show)}
            aria-label={show ? "Hide password" : "Show password"}
          >
            {show ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        )}
      </div>
    </div>
  );
}

export function AuthError({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <div className="login-error" role="alert">
      <AlertCircle size={16} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

/** Teal informational banner — for success/notice states (email sent, etc.). */
export function AuthNotice({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <div className="login-notice" role="status">
      <Icon size={16} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function AuthSubmit({ loading, loadingLabel, label }: { loading: boolean; loadingLabel: string; label: string }) {
  return (
    <button type="submit" className="login-btn" disabled={loading}>
      {loading ? (
        <>
          <Loader2 size={18} className="spin" />
          {loadingLabel}
        </>
      ) : (
        <>
          <span>{label}</span>
          <ArrowRight size={18} />
        </>
      )}
    </button>
  );
}

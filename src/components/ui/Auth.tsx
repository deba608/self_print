"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
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
            <Link href="/" className="login-logo" aria-label="Back to Self Print home">
              <Printer size={32} strokeWidth={1.5} />
            </Link>
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
        <label htmlFor={id}>
          {label}
          {required && <span className="input-required-mark" aria-hidden="true"> *</span>}
        </label>
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

export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="auth-divider">
      <span>{label}</span>
    </div>
  );
}

export function GoogleAuthButton({ onClick, disabled, label = "Continue with Google" }: { onClick: () => void; disabled?: boolean; label?: string }) {
  return (
    <button type="button" className="login-btn login-btn-google" onClick={onClick} disabled={disabled}>
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
        <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.71v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.61z" />
        <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.36 0-4.36-1.6-5.08-3.75H.9v2.33A9 9 0 0 0 9 18z" />
        <path fill="#FBBC05" d="M3.92 10.67A5.4 5.4 0 0 1 3.64 9c0-.58.1-1.15.28-1.67V5H.9a9 9 0 0 0 0 8l3.02-2.33z" />
        <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58A8.64 8.64 0 0 0 9 0 9 9 0 0 0 .9 5l3.02 2.33C4.64 5.18 6.64 3.58 9 3.58z" />
      </svg>
      <span>{label}</span>
    </button>
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

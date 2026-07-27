import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  icon?: LucideIcon;
  loading?: boolean;
  children: ReactNode;
};

export default function Button({
  variant = "primary",
  icon: Icon,
  loading = false,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      className={`ui-btn ui-btn--${variant}${className ? ` ${className}` : ""}`}
      disabled={disabled || loading}
      {...rest}
    >
      {loading ? <Loader2 size={16} className="spin" aria-hidden="true" /> : Icon ? <Icon size={16} aria-hidden="true" /> : null}
      <span>{children}</span>
    </button>
  );
}

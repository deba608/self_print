import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export type BadgeVariant = "neutral" | "primary" | "success" | "danger" | "warning" | "info";

/**
 * Status badge — always icon + text so state is never conveyed by color
 * alone. Variants map to the semantic status table in docs/UI_UX_PLAN.md §1.2.
 */
export default function Badge({
  variant = "neutral",
  icon: Icon,
  children,
}: {
  variant?: BadgeVariant;
  icon?: LucideIcon;
  children: ReactNode;
}) {
  return (
    <span className={`ui-badge ui-badge--${variant}`}>
      {Icon && <Icon size={13} strokeWidth={2.5} aria-hidden="true" />}
      {children}
    </span>
  );
}

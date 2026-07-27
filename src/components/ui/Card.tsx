import type { HTMLAttributes, ReactNode } from "react";

export default function Card({
  className,
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { children: ReactNode }) {
  return (
    <div className={`ui-card${className ? ` ${className}` : ""}`} {...rest}>
      {children}
    </div>
  );
}

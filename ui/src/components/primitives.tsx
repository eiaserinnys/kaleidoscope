import type { MouseEvent, ReactNode } from "react";

export interface ButtonProps {
  children: ReactNode;
  variant?: "default" | "emphasis";
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  type?: "button" | "submit";
  "aria-pressed"?: boolean;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
}

export function Button({
  children,
  variant = "default",
  disabled = false,
  onClick,
  type = "button",
  "aria-pressed": pressed,
  "aria-label": label,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
}: ButtonProps) {
  return (
    <button
      className={`ks-button ks-button-${variant}${pressed === true ? " is-selected" : ""}`}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      onClick={onClick}
      type={type}
    >
      {children}
    </button>
  );
}

export interface IconButtonProps {
  "aria-label": string;
  children: ReactNode;
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  pressed?: boolean;
  tone?: "share";
}

export function IconButton({ "aria-label": label, children, disabled, onClick, title, pressed, tone }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      aria-pressed={pressed}
      className={`ks-icon-button${tone === "share" ? " ks-icon-button-share" : ""}`}
      disabled={disabled}
      onClick={onClick}
      type="button"
      title={title ?? label}
    >
      {children}
    </button>
  );
}

export function EmptyState({
  icon,
  text,
  action,
}: {
  icon: ReactNode;
  text?: string;
  action?: ReactNode;
}) {
  return (
    <div className={`ks-empty-state${text ? "" : " ks-empty-state-without-text"}`}>
      <span aria-hidden="true" className="ks-empty-state-icon">{icon}</span>
      {text ? <span className="ks-empty-state-text">{text}</span> : null}
      {action ? <span className="ks-empty-state-action">{action}</span> : null}
    </div>
  );
}

export function Notice({
  children,
  actions,
  role = "status",
  "data-ks-overlay": overlay,
}: {
  children: ReactNode;
  actions?: [ReactNode] | [ReactNode, ReactNode];
  role?: "alert" | "status";
  "data-ks-overlay"?: boolean;
}) {
  return (
    <div className="ks-notice" data-ks-overlay={overlay || undefined} role={role}>
      <span className="ks-notice-message">{children}</span>
      {actions ? <span className="ks-notice-actions">{actions}</span> : null}
    </div>
  );
}

export function StatusText({ children }: { children: ReactNode }) {
  return <span aria-live="polite" className="ks-status-text" role="status">{children}</span>;
}

import type { ReactNode } from "react";

export interface ButtonProps {
  children: ReactNode;
  variant?: "default" | "emphasis";
  disabled?: boolean;
  onClick?: () => void;
  type?: "button" | "submit";
}

export function Button({
  children,
  variant = "default",
  disabled = false,
  onClick,
  type = "button",
}: ButtonProps) {
  return (
    <button
      className={`ks-button ks-button-${variant}`}
      disabled={disabled}
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
  onClick?: () => void;
}

export function IconButton({ "aria-label": label, children, disabled, onClick }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className="ks-icon-button"
      disabled={disabled}
      onClick={onClick}
      type="button"
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
  text: string;
  action?: ReactNode;
}) {
  return (
    <div className="ks-empty-state">
      <span aria-hidden="true" className="ks-empty-state-icon">{icon}</span>
      <span className="ks-empty-state-text">{text}</span>
      {action ? <span className="ks-empty-state-action">{action}</span> : null}
    </div>
  );
}

export function Notice({
  children,
  actions,
  role = "status",
}: {
  children: ReactNode;
  actions?: [ReactNode] | [ReactNode, ReactNode];
  role?: "alert" | "status";
}) {
  return (
    <div className="ks-notice" role={role}>
      <span className="ks-notice-message">{children}</span>
      {actions ? <span className="ks-notice-actions">{actions}</span> : null}
    </div>
  );
}

export function StatusText({ children }: { children: ReactNode }) {
  return <span aria-live="polite" className="ks-status-text" role="status">{children}</span>;
}

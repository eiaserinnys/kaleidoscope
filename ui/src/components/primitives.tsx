import { Fragment, type MouseEvent, type ReactNode, type Ref } from "react";
import { LinkedText } from "./external-link";
import { Tooltip } from "./tooltip";
import type { CoreError } from "../contract/contract";

export interface ButtonProps {
  rootProps?: import("../comments/block-root").BlockRootProps;
  ref?: Ref<HTMLButtonElement>;
  className?: string,
  children: ReactNode;
  variant?: "default" | "emphasis";
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  type?: "button" | "submit";
  title?: string;
  "aria-pressed"?: boolean;
  "aria-expanded"?: boolean;
  "aria-haspopup"?: "dialog" | "listbox";
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  "aria-disabled"?: boolean;
  "aria-busy"?: boolean;
  "data-ks-user-consent"?: boolean;
  onPointerEnter?: React.PointerEventHandler<HTMLButtonElement>;
  onPointerLeave?: React.PointerEventHandler<HTMLButtonElement>;
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  onFocus?: React.FocusEventHandler<HTMLButtonElement>;
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
}

export function Button({
  rootProps,
  ref,
  children,
  className,
  variant = "default",
  disabled = false,
  onClick,
  type = "button",
  title,
  "aria-pressed": pressed,
  "aria-expanded": expanded,
  "aria-haspopup": hasPopup,
  "aria-label": label,
  "aria-invalid": invalid,
  "aria-describedby": describedBy,
  "aria-disabled": ariaDisabled,
  "aria-busy": ariaBusy,
  "data-ks-user-consent": userConsent,
  onPointerEnter, onPointerLeave, onPointerDown, onFocus, onBlur,
}: ButtonProps) {
  return (
    <button
      {...rootProps}
      ref={ref}
      className={`ks-button ks-button-${variant}${pressed === true ? " is-selected" : ""}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      aria-pressed={pressed}
      aria-expanded={expanded}
      aria-haspopup={hasPopup}
      aria-label={label}
      aria-invalid={invalid}
      aria-describedby={describedBy}
      aria-disabled={ariaDisabled}
      aria-busy={ariaBusy}
      data-ks-user-consent={userConsent || undefined}
      onClick={onClick}
      onPointerEnter={onPointerEnter} onPointerLeave={onPointerLeave} onPointerDown={onPointerDown} onFocus={onFocus} onBlur={onBlur}
      type={type}
      title={title}
    >
      {children}
    </button>
  );
}

export interface IconButtonProps {
  "aria-label": string;
  tooltip?: ReactNode;
  tooltipEnabled?: boolean;
  children: ReactNode;
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  title?: string;
  pressed?: boolean;
  tone?: "share";
  className?: string;
  variant?: "embedded" | "taskbar";
  tabIndex?: number;
  onPointerDown?: React.PointerEventHandler<HTMLButtonElement>;
  onPointerUp?: React.PointerEventHandler<HTMLButtonElement>;
  onPointerCancel?: React.PointerEventHandler<HTMLButtonElement>;
  onLostPointerCapture?: React.PointerEventHandler<HTMLButtonElement>;
  onBlur?: React.FocusEventHandler<HTMLButtonElement>;
  "aria-disabled"?: boolean;
  "aria-busy"?: boolean;
  "data-ks-user-consent"?: boolean;
  "data-window-control"?: string;
  "aria-haspopup"?: "dialog" | "listbox";
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
}

export function IconButton({ "aria-label": label, children, disabled, onClick, title, pressed, tone, className, tooltip, tooltipEnabled, variant, tabIndex, onPointerDown, onPointerUp, onPointerCancel, onLostPointerCapture, onBlur, "aria-disabled": ariaDisabled, "aria-busy": ariaBusy, "data-ks-user-consent": userConsent, "data-window-control": windowControl, "aria-haspopup": hasPopup, "aria-expanded": expanded, "aria-controls": controls }: IconButtonProps) {
  const button = (
    <button
      aria-label={label}
      aria-pressed={pressed}
      aria-disabled={ariaDisabled}
      aria-busy={ariaBusy}
      aria-haspopup={hasPopup}
      aria-expanded={expanded}
      aria-controls={controls}
      data-ks-user-consent={userConsent || undefined}
      data-window-control={windowControl}
      className={`ks-icon-button${tone === "share" ? " ks-icon-button-share" : ""}${variant ? ` is-${variant}` : ""}${className ? ` ${className}` : ""}`}
      disabled={disabled}
      tabIndex={tabIndex}
      onClick={onClick}
      onPointerDown={onPointerDown} onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onLostPointerCapture={onLostPointerCapture} onBlur={onBlur}
      type="button"
      title={tooltip != null ? undefined : title ?? label}
    >
      {children}
    </button>
  );
  return tooltip != null ? <Tooltip content={tooltip} enabled={tooltipEnabled}>{button}</Tooltip> : button;
}

export function EmptyState({
  icon,
  text,
  action,
  rootProps,
  className = "",
}: {
  icon?: ReactNode;
  text?: ReactNode;
  action?: ReactNode;
  rootProps?: import("../comments/block-root").BlockRootProps;
  className?: string;
}) {
  return (
    <div {...rootProps} className={`ks-empty-state${text ? "" : " ks-empty-state-without-text"} ${className}`}>
      {icon != null ? <span aria-hidden="true" className="ks-empty-state-icon">{icon}</span> : null}
      {text ? <span className="ks-empty-state-text">{text}</span> : null}
      {action ? <span className="ks-empty-state-action">{action}</span> : null}
    </div>
  );
}

export function Notice({
  children,
  actions,
  details,
  errorId,
  onDismiss,
  role = "status",
  "data-ks-overlay": overlay,
  rootProps,
  commentKey,
}: {
  children: ReactNode;
  actions?: ReactNode[];
  details?: ReactNode;
  errorId?: string | null;
  onDismiss?: () => void;
  role?: "alert" | "status";
  "data-ks-overlay"?: boolean;
  rootProps?: import("../comments/block-root").BlockRootProps;
  commentKey?: string;
}) {
  return (
    <div {...rootProps} data-ks-comment-key={commentKey} className={`ks-notice${actions && actions.length > 1 ? " has-multiple-actions" : ""}`} data-ks-overlay={overlay || undefined} role={role} onKeyDown={onDismiss ? (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onDismiss();
    } : undefined}>
      <span className="ks-notice-message">{typeof children === "string" ? <LinkedText text={children} /> : children}{errorId ? <> <ErrorId id={errorId} /></> : null}</span>
      {actions ? <span className="ks-notice-actions">{actions}</span> : null}
      {details ? <div className="ks-notice-details">{details}</div> : null}
    </div>
  );
}

export function ErrorId({ id }: { id: string }) {
  const parts = id.split("_");
  return <code className="ks-error-id">{parts.map((part, index) => <Fragment key={index}>{part}{index < parts.length - 1 ? <>_<wbr /></> : null}</Fragment>)}</code>;
}

export function ErrorNotice({ error, actions }: { error: CoreError; actions?: ReactNode[] }) {
  return <Notice role="alert" errorId={error.id} actions={actions}>{error.message}</Notice>;
}

export function StatusText({ children }: { children: ReactNode }) {
  return <span aria-live="polite" className="ks-status-text" role="status">{children}</span>;
}

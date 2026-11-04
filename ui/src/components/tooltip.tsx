import { cloneElement, createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type ReactElement, type ReactNode } from "react";
import { AnchoredOverlay } from "./anchored-overlay";

export const TOOLTIP_OPEN_DELAY_MS = 500;
export const TOOLTIP_SKIP_DELAY_MS = 300;

type Manager = { active: (() => void) | null; lastClosed: number };
const TooltipContext = createContext<Manager | null>(null);
export function TooltipProvider({ children }: { children: ReactNode }) {
  const manager = useRef<Manager>({ active: null, lastClosed: -Infinity });
  return <TooltipContext.Provider value={manager.current}>{children}</TooltipContext.Provider>;
}

type TriggerProps = ButtonHTMLAttributes<HTMLButtonElement> & { ref?: React.Ref<HTMLButtonElement> };
export function Tooltip({ children, content, enabled = true }: { children: ReactElement<TriggerProps>; content: ReactNode; enabled?: boolean }) {
  const shared = useContext(TooltipContext);
  const local = useRef<Manager>({ active: null, lastClosed: -Infinity });
  const manager = shared ?? local.current;
  const id = useId();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const openRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovered = useRef(false);
  const focused = useRef(false);
  const blocked = useRef(false);
  const cancelTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const close = () => {
    cancelTimer();
    if (openRef.current) { openRef.current = false; setOpen(false); manager.lastClosed = Date.now(); }
    if (manager.active === closeRef.current) manager.active = null;
  };
  const closeRef = useRef(close);
  closeRef.current = close;
  const show = () => {
    cancelTimer();
    if (!enabled || !content || blocked.current) return;
    manager.active?.();
    manager.active = closeRef.current;
    openRef.current = true;
    setOpen(true);
  };
  const enter = () => {
    hovered.current = true;
    if (blocked.current || !enabled || !content) return;
    cancelTimer();
    if (Date.now() - manager.lastClosed <= TOOLTIP_SKIP_DELAY_MS) show();
    else timer.current = setTimeout(show, TOOLTIP_OPEN_DELAY_MS);
  };
  const leave = (related: EventTarget | null) => {
    if (related instanceof Node && (anchor?.contains(related) || document.getElementById(id)?.contains(related))) return;
    hovered.current = false;
    if (!focused.current) { close(); blocked.current = false; }
  };
  useEffect(() => {
    if (!enabled || !content) closeRef.current();
  }, [enabled, content]);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && (openRef.current || timer.current)) { blocked.current = true; closeRef.current(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); closeRef.current(); };
  }, [manager]);
  const props = children.props;
  const triggerRef = useCallback((element: HTMLButtonElement | null) => {
    setAnchor(element);
    if (typeof props.ref === "function") props.ref(element);
    else if (props.ref) props.ref.current = element;
  }, [props.ref]);
  const trigger = cloneElement(children, {
    ref: triggerRef,
    "aria-describedby": [props["aria-describedby"], open ? id : undefined].filter(Boolean).join(" ") || undefined,
    onPointerEnter: (event) => { props.onPointerEnter?.(event); if (event.pointerType !== "touch") enter(); },
    onPointerLeave: (event) => { props.onPointerLeave?.(event); leave(event.relatedTarget); },
    onFocus: (event) => { props.onFocus?.(event); focused.current = event.currentTarget.matches(":focus-visible"); if (focused.current) show(); },
    onBlur: (event) => { props.onBlur?.(event); focused.current = false; close(); blocked.current = false; },
    onPointerDown: (event) => { props.onPointerDown?.(event); blocked.current = true; close(); },
    onClick: (event) => { props.onClick?.(event); blocked.current = true; close(); },
  });
  return <>{trigger}
    {open && anchor && enabled && content ? <AnchoredOverlay anchor={anchor} id={id} className="ks-tooltip" onPointerEnter={() => { hovered.current = true; }} onPointerLeave={(event) => leave(event.relatedTarget)}>{content}</AnchoredOverlay> : null}
  </>;
}

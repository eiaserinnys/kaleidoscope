import { eventModifiers } from "../runtime/shortcuts";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import type { Block, SelectOption } from "../contract/contract";
import { ICON_NAMES } from "../contract/limits";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import type { BlockContext } from "./block-context";
import { useBinding, useWindowData } from "../data/window-data";
import { BindingFailureNotice, DataState, isMessageBindingFailure } from "../components/data-state";
import { DataIcon } from "../components/data-icons";
import { LoaderCircle } from "../components/icons";
import { Dialog } from "../components/dialog";
import { Select, Toggle } from "../components/select-toggle";
import { Button, ErrorId, IconButton } from "../components/primitives";
import { Tooltip } from "../components/tooltip";
import { display } from "./data-layout";
import { asArray } from "./data-view-common";
import { useLocalDraft } from "../data/use-local-draft";
import { useWindowVisible } from "../data/window-state";
import { isClock, useClockPosition } from "../data/clock";
import { renderBlock } from "../render/render-block";
import { PreviewContext } from "./preview-context";

interface Props<T extends Block["type"]> { block: Extract<Block, { type: T }>; context: BlockContext; pointer: string }
const fieldPosition = (position: "inline" | "top" | "hidden" | undefined) => position && position !== "inline" ? ` is-label-${position}` : "";
function bindingText(value: ReturnType<typeof useBinding>): string {
  return value.status === "ready" && value.value !== null && value.value !== undefined ? display(value.value) : "";
}
const bindingName = (value: unknown, fallback: string) => {
  if (value && typeof value === "object") {
    if ("state" in value && typeof value.state === "string") return value.state;
    if ("client" in value && typeof value.client === "string") return value.client;
  }
  return fallback;
};

export { InputBlock } from "./input-block";

function validOption(value: unknown): value is SelectOption {
  return typeof value === "string" || (typeof value === "object" && value !== null && "label" in value && typeof value.label === "string" && "value" in value);
}

function validGroup(value: unknown): value is { name: string; options: unknown[] } {
  return typeof value === "object" && value !== null && "name" in value && typeof value.name === "string" && "options" in value && Array.isArray(value.options);
}

export function SliderBlock({ block, pointer, context }: Props<"slider">) {
  const value = useBinding(`${pointer}/value`, block.value);
  const clock = value.status === "ready" && isClock(value.value) ? value.value : null;
  if (clock) return <ClockSlider block={block} pointer={pointer} context={context} clock={clock} />;
  const raw = Number((value.status === "ready" ? value.value : null) ?? block.min);
  const current = Number.isFinite(raw) ? raw : block.min;
  return <SliderControl block={block} pointer={pointer} current={current} />;
}

function ClockSlider({ block, pointer, context, clock }: {
  block: Extract<Block, { type: "slider" }>;
  pointer: string;
  context: BlockContext;
  clock: import("../contract/contract").Clock;
}) {
  const visible = useWindowVisible(context);
  return <SliderControl block={block} pointer={pointer} current={useClockPosition(clock, visible)} />;
}

function SliderControl({ block, pointer, current }: {
  block: Extract<Block, { type: "slider" }>;
  pointer: string;
  current: number;
}) {
  const label = useBinding(`${pointer}/label`, block.label ?? null);
  const hasLabel = block.label != null;
  const labelText = hasLabel ? bindingText(label) : "";
  const { draft, change, finish, holding } = useLocalDraft(current, pointer);
  return <><label className={`ks-field ks-slider-field${fieldPosition(block.label_position)}${block.show_value === false ? " is-value-hidden" : ""}`}>
    {hasLabel && block.label_position !== "hidden" ? <span className="ks-field-label" data-ks-share-skip="">{labelText}</span> : null}
    <input type="range" className="ks-slider" aria-label={labelText || bindingName(block.value, "슬라이더")} min={block.min} max={block.max} step={block.step ?? 1} value={draft}
      onPointerDown={() => { holding.current = true; }} onPointerUp={() => finish()} onPointerCancel={() => finish()} onBlur={() => finish()}
      onKeyDown={() => { holding.current = true; }} onKeyUp={() => finish()}
      onChange={(event) => { const next = Number(event.currentTarget.value); change(next); if (event.nativeEvent.type === "change") finish(); }} />
    {block.show_value !== false ? <span className="ks-slider-value" data-ks-share-skip="">{draft}</span> : null}
  </label><BindingFailureNotice value={label} /></>;
}

export function ColorBlock({ block, pointer }: Props<"color">) {
  const bound = useBinding(`${pointer}/value`, block.value);
  const disabled = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  const label = useBinding(`${pointer}/label`, block.label ?? null);
  const hasLabel = block.label != null;
  const labelText = hasLabel ? bindingText(label) : "";
  const value = bound.status === "ready" ? bound.value : null;
  const current = typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : "#000000";
  const unavailable = disabled.status !== "ready" || Boolean(disabled.value);
  const { draft: color, change, finish, holding } = useLocalDraft(current, pointer);
  return <><label className={`ks-field ks-color-field${fieldPosition(block.label_position)}${unavailable ? " is-disabled" : ""}`}>
    {hasLabel && block.label_position !== "hidden" ? <span className="ks-field-label" data-ks-share-skip="">{labelText}</span> : null}
    <span className="ks-color-control"><input className="ks-color-input" type="color" aria-label={labelText || bindingName(block.value, "색상")} value={color} disabled={unavailable}
      onPointerDown={() => { holding.current = true; }} onPointerUp={() => finish()} onPointerCancel={() => finish()} onBlur={() => finish()} onKeyDown={() => { holding.current = true; }} onKeyUp={() => finish()}
      onChange={(event) => { change(event.currentTarget.value.toLowerCase()); if (event.nativeEvent.type === "change") finish(); }} /><span className="ks-color-code" data-ks-share-skip="">{color}</span></span>
  </label><BindingFailureNotice value={label} /></>;
}
export function SelectBlock({ block, pointer }: Props<"select">) {
  const data = useWindowData();
  const options = useBinding(`${pointer}/options`, block.options);
  const value = useBinding(`${pointer}/value`, block.value);
  const label = useBinding(`${pointer}/label`, block.label ?? null);
  const placeholder = useBinding(`${pointer}/placeholder`, block.placeholder ?? null);
  const disabled = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  const hasLabel = block.label != null;
  const labelText = hasLabel ? bindingText(label) : undefined;
  const placeholderText = block.placeholder === undefined ? undefined : bindingText(placeholder);
  if (options.status !== "ready") return <DataState value={options} compact />;
  const entries = asArray(options.value);
  const hasGroups = entries.some(validGroup);
  const toChoice = (option: SelectOption) => typeof option === "string" ? { value: option, label: option } : option;
  const groups = entries.flatMap((entry) => {
    if (validGroup(entry)) return [{ name: entry.name, options: entry.options.filter(validOption).map(toChoice) }];
    return validOption(entry) ? [{ name: "", options: [toChoice(entry)] }] : [];
  });
  const props = { value: value.status === "ready" ? value.value : null, placeholder: placeholderText, segmented: block.style === "segmented", label: labelText, disabled: disabled.status !== "ready" || Boolean(disabled.value), onChange: (next: JsonValue) => { void data.act(`${pointer}/on_change`, next); } };
  const select = hasGroups ? <Select {...props} groups={groups} /> : <Select {...props} items={entries.filter(validOption)} />;
  return hasLabel ? <><label className={`ks-field ks-select-field${fieldPosition(block.label_position)}`}>{block.label_position !== "hidden" ? <span className="ks-field-label" data-ks-share-skip="">{labelText}</span> : null}{select}</label><BindingFailureNotice value={label} /></> : select;
}

export function ToggleBlock({ block, pointer }: Props<"toggle">) {
  const data = useWindowData();
  const value = useBinding(`${pointer}/value`, block.value);
  const label = useBinding(`${pointer}/label`, block.label);
  const disabled = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  return <><Toggle checked={value.status === "ready" && Boolean(value.value)} disabled={value.status !== "ready" || disabled.status !== "ready" || Boolean(disabled.value)} label={block.label != null ? bindingText(label) : undefined} labelVisible={block.label != null} onChange={(value) => { void data.act(`${pointer}/on_change`, value); }} /><BindingFailureNotice value={label} /></>;
}

export function ButtonBlock({ block, context, pointer }: Props<"button">) {
  const data = useWindowData();
  const label = useBinding(`${pointer}/label`, block.label);
  const description = useBinding(`${pointer}/description`, block.description ?? null);
  const visible = useWindowVisible(context);
  const icon = useBinding(`${pointer}/icon`, block.icon ?? null);
  const variantBinding = useBinding(`${pointer}/variant`, block.variant ?? "default");
  const prefix = useBinding(`${pointer}/prefix`, block.prefix ?? null);
  const pressed = useBinding(`${pointer}/pressed`, block.pressed ?? null);
  const disabled = useBinding(`${pointer}/disabled`, block.disabled ?? false);
  const body = useBinding(`${pointer}/confirm/body`, block.confirm?.body ?? null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const busyRef = useRef(false);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [copySucceeded, setCopySucceeded] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const setOpener = useCallback((node: HTMLElement | null) => { opener.current = node; }, []);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoreAfterAction = useRef(false);
  const confirmModifiers = useRef<ReturnType<typeof eventModifiers> | undefined>(undefined);
  const close = useCallback(() => setConfirm(false), []);
  const labelText = label.status === "ready" && typeof label.value === "string" ? label.value : "";
  const descriptionText = description.status === "ready" && typeof description.value === "string" ? description.value.trim() : "";
  const tooltipContent = block.icon_only ? <><div className="ks-tooltip-line">{labelText}</div>{descriptionText && descriptionText !== labelText ? <div className="ks-tooltip-line">{descriptionText}</div> : null}</> : descriptionText;
  const labelLoading = label.status === "loading";
  const prefixText = block.prefix !== undefined ? bindingText(prefix) : "";
  const labelFailure = isMessageBindingFailure(label) ? label : null;
  const prefixFailure = isMessageBindingFailure(prefix) ? prefix : null;
  const bindingFailure = labelFailure ?? prefixFailure;
  const accessibleName = bindingFailure
    ? [labelText, bindingFailure.id].filter(Boolean).join(": ")
    : labelLoading ? "불러오는 중" : prefixText ? `${prefixText}: ${labelText}` : labelText;
  const iconText = icon.status === "ready" && typeof icon.value === "string" ? icon.value : "";
  const variant = variantBinding.status === "ready" && typeof variantBinding.value === "string" && ["default", "primary", "danger", "ghost", "chip"].includes(variantBinding.value) ? variantBinding.value : "default";
  const pressedValue = block.pressed !== undefined && pressed.status === "ready" ? Boolean(pressed.value) : undefined;
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current); if (progressTimer.current) clearTimeout(progressTimer.current); }, []);
  const run = async (restore: boolean, modifiers?: ReturnType<typeof eventModifiers>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    restoreAfterAction.current = restore;
    setConfirm(false);
    setBusy(true);
    progressTimer.current = setTimeout(() => { setShowProgress(true); progressTimer.current = null; }, 250);
    const succeeded = await data.act(`${pointer}/on_click`, null, undefined, modifiers);
    if (progressTimer.current) clearTimeout(progressTimer.current);
    progressTimer.current = null;
    setShowProgress(false);
    busyRef.current = false;
    setBusy(false);
    if (succeeded && copyTextAction(block.on_click)) {
      setCopySucceeded(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => { setCopySucceeded(false); copyTimer.current = null; }, 1500);
    }
  };
  const unavailable = disabled.status !== "ready" || Boolean(disabled.value) || bindingFailure !== null || labelLoading;
  useLayoutEffect(() => {
    if (!busy && !unavailable && restoreAfterAction.current) {
      restoreAfterAction.current = false;
      opener.current?.querySelector<HTMLButtonElement>(".ks-data-button-card-action, :scope > button")?.focus();
    }
  });
  const hasIcon = (ICON_NAMES as readonly string[]).includes(iconText);
  const copied = copySucceeded && copyTextAction(block.on_click);
  const buttonLabel = labelLoading ? <span aria-hidden="true" className="ks-data-button-label ks-data-skeleton"><i /></span> : prefixText
    ? <><span className="ks-data-button-prefix">{prefixText}</span><span className="ks-data-button-label is-emphasized ks-truncate-label">{labelText}</span></>
    : <span className="ks-data-button-label ks-truncate-label">{labelText}</span>;
  const progress = <span className="ks-button-progress" aria-hidden="true"><LoaderCircle size="control" /></span>;
  const contents = <>{!(showProgress && block.icon_only) && (bindingFailure ? <DataIcon name="triangle-alert" /> : hasIcon ? <DataIcon name={copied ? "check" : iconText} /> : null)}{!block.icon_only ? buttonLabel : null}{showProgress ? progress : null}</>;
  const onClick = (event: MouseEvent<HTMLButtonElement>) => {
    if (busyRef.current) return;
    const modifiers = eventModifiers(event);
    if (block.confirm) { confirmModifiers.current = modifiers; setConfirm(true); }
    else void run(false, modifiers);
  };
  const host = opener.current?.closest<HTMLElement>(".ks-data-window");
  const status = <span aria-live="polite" className="ks-accessible-hidden" role="status">{copied ? "복사했습니다" : ""}</span>;
  const previewFailure = bindingFailure ? <span aria-label={bindingFailure.message} className="ks-data-button-card-failure" role="alert">
    <DataIcon name="triangle-alert" size="inline" /><ErrorId id={bindingFailure.id} />
  </span> : null;
  const dialog = confirm && block.confirm && host
    ? <Dialog host={host} title={block.confirm.title} ok={block.confirm.ok ?? labelText} danger={variant === "danger"} onCancel={close} onConfirm={() => void run(true, confirmModifiers.current)} body={block.confirm.body === undefined ? undefined : body.status === "ready" ? display(body.value) : <DataState value={body} compact />} />
    : null;
  const className = `ks-data-button is-${variant}`;
  if (block.preview) return <div ref={setOpener} className={`${className} has-preview`}>
    <div className={`ks-data-button-card${pressedValue ? " is-selected" : ""}${busy || unavailable ? " is-disabled" : ""}`} title={previewError ?? undefined}>
      <div className="ks-data-button-card-content">
        <div className="ks-data-button-card-preview" aria-hidden="true" inert><PreviewContext.Provider value={setPreviewError}>{renderBlock(block.preview, context, `${pointer}/preview`)}</PreviewContext.Provider></div>
        <div aria-hidden={bindingFailure ? undefined : true} className={`ks-data-button-card-label${bindingFailure ? " is-failure" : ""}${showProgress ? " is-progress" : ""}`}>
          {!bindingFailure && prefixText ? <><span className="ks-data-button-prefix">{prefixText}</span><wbr /></> : null}
          {!bindingFailure ? labelLoading ? <span aria-hidden="true" className="ks-data-button-label ks-data-skeleton"><i /></span> : <span className="ks-data-button-label is-emphasized">{labelText}</span> : null}
          {previewFailure}
          {showProgress ? progress : null}
        </div>
      </div>
      <Tooltip content={tooltipContent} enabled={visible}><Button aria-label={accessibleName} className="ks-data-button-card-action" aria-pressed={pressedValue} disabled={unavailable} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={onClick}>
        <span className="ks-accessible-hidden">{accessibleName}</span>
      </Button></Tooltip>
    </div>
    {status}{dialog}
  </div>;
  const control = <span ref={setOpener} className={className}>{block.icon_only
    ? <IconButton aria-label={accessibleName} tooltip={tooltipContent} tooltipEnabled={visible} pressed={pressedValue} className={showProgress ? "is-progress" : undefined} disabled={unavailable} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={onClick}>{contents}</IconButton>
    : <Tooltip content={tooltipContent} enabled={visible}><Button aria-label={accessibleName} aria-pressed={pressedValue} className={showProgress ? "is-progress" : undefined} variant={variant === "primary" ? "emphasis" : "default"} disabled={unavailable} aria-disabled={busy || undefined} aria-busy={busy || undefined} onClick={onClick}>{contents}</Button></Tooltip>}
    {status}{dialog}
  </span>;
  return bindingFailure
    ? <div aria-label={bindingFailure.message} className="ks-data-button-failure-item" role="alert" title={bindingFailure.message}>
      {control}<div className="ks-data-state-compact"><ErrorId id={bindingFailure.id} /></div>
    </div>
    : control;
}

function copyTextAction(actions: unknown): boolean {
  const isCopy = (action: unknown) => action !== null && typeof action === "object" && "copy_text" in action;
  return Array.isArray(actions) ? actions.length === 1 && isCopy(actions[0]) : isCopy(actions);
}

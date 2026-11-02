import { useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { AlignCenter, AlignCenterHorizontal, AlignCenterVertical, AlignEndHorizontal, AlignEndVertical, AlignHorizontalSpaceBetween, AlignJustify, AlignLeft, AlignRight, AlignStartHorizontal, AlignStartVertical, AlignVerticalSpaceBetween, ArrowDown, ArrowRight, ArrowUp, Copy, EyeOff, MousePointer2, Trash2 } from "../../components/icons";
import { Button, EmptyState, IconButton } from "../../components/primitives";
import { Select } from "../../components/select-toggle";
import type { useHtmlDocument } from "./controller";
import { ColorField, hexColor, NumberField } from "./fields";
import { Group, Target } from "./parts";

type Model = ReturnType<typeof useHtmlDocument>;
type Icon = ComponentType<{ size?: "inline" | "control" | "empty" | "tile" }>;
const shadows: Record<string, string> = { "없음": "none", "작게": "0 1px 2px rgb(0 0 0 / 12%)", "보통": "0 4px 12px rgb(0 0 0 / 16%)", "크게": "0 12px 32px rgb(0 0 0 / 20%)" };
const computedShadows: Record<string, string> = { "none": "없음", "rgba(0, 0, 0, 0.12) 0px 1px 2px 0px": "작게", "rgba(0, 0, 0, 0.16) 0px 4px 12px 0px": "보통", "rgba(0, 0, 0, 0.2) 0px 12px 32px 0px": "크게" };
const numeric = (value: string | undefined, fallback = "0") => {
  const text = value?.trim();
  if (!text || text === "normal" || text === "auto") return fallback;
  return /\s/.test(text) ? "혼합" : text.replace(/px$/, "");
};

function Alignment({ label, options, value, set }: { label: string; options: { label: string; value: string; icon: Icon }[]; value: string; set: (value: string) => void }) {
  return <div className="ks-data-segmented ks-html-align" role="group" aria-label={label}>{options.map((option) => <Button key={option.value} className="ks-html-icon" aria-label={option.label} title={option.label} aria-pressed={value === option.value} onClick={() => set(option.value)}><option.icon size="inline" /></Button>)}</div>;
}

function TextField({ value, change }: { value: string; change: (text: string) => void }) {
  const [draft, setDraft] = useState(value); const before = useRef(value); const cancelled = useRef(false);
  useEffect(() => { setDraft(value); }, [value]);
  return <textarea className="ks-text-input ks-html-text is-6" rows={1} aria-label="문구" value={draft} onFocus={() => { before.current = value; cancelled.current = false; }} onChange={(event) => setDraft(event.target.value)} onBlur={() => { if (!cancelled.current && draft !== value) change(draft); }} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); cancelled.current = true; setDraft(before.current); event.currentTarget.blur(); } }} />;
}

export function PropertyFace({ model }: { model: Model }) {
  const [activeColor, setActiveColor] = useState<string | null>(null);
  const displayBefore = useRef(new Map<number, string>());
  const pointerDown = useRef(false);
  const selection = model.selection;
  if (!selection) return <div className="ks-html-rail-body"><div className="ks-html-rail-empty"><EmptyState icon={<MousePointer2 size="empty" />} text="요소를 고르세요" /></div></div>;
  const styles = selection.styles; const display = styles.display ?? "";
  const layout = ["flex", "inline-flex", "grid", "inline-grid"].includes(display);
  const grid = display.includes("grid"); const vertical = grid ? styles["grid-auto-flow"]?.startsWith("column") : styles["flex-direction"]?.startsWith("column");
  const label = selection.anchor.tag; const body = label === "body";
  const expanded = (name: string, fallback: boolean) => model.propertyGroups[name] ?? fallback;
  const group = (name: string, fallback: boolean, children: ReactNode) => <Group title={name} open={expanded(name, fallback)} onToggle={() => model.setPropertyGroups((previous) => ({ ...previous, [name]: !expanded(name, fallback) }))}>{children}</Group>;
  const value = (prop: string, fallback = "0") => numeric(styles[prop], fallback);
  const field = (labelText: string, prop: string, opts: { value?: string; step?: number; min?: number; max?: number; unit?: string; span?: string; box?: string } = {}) => <NumberField key={`${selection.n}:${prop}`} label={labelText} prop={prop} value={opts.value ?? value(prop)} step={opts.step} min={opts.min} max={opts.max} unit={opts.unit} span={opts.span} box={opts.box} preview={model.previewStyle} commit={model.editStyle} />;
  const borderAbsent = (styles["border-style"] ?? "none").split(/\s+/).every((part) => part === "none") || (styles["border-width"] ?? "0").split(/\s+/).every((part) => Number.parseFloat(part) === 0);
  const color = (labelText: string, prop: string, span?: string, readOnly?: string) => <ColorField key={`${selection.n}:${prop}`} label={labelText} prop={prop} value={prop === "border-color" && borderAbsent ? "transparent" : styles[prop] ?? ""} span={span} readOnly={readOnly} focus={setActiveColor} preview={model.previewStyle} commit={model.editStyle} />;
  const swatches = (prop: string) => activeColor === prop ? <div className="ks-html-swatches is-6">{[...new Set((selection.colors ?? []).map(hexColor).filter((item): item is string => Boolean(item)))].map((item) => <button key={item} type="button" className="ks-html-swatch-chip" style={{ background: item }} aria-label={item} aria-pressed={hexColor(styles[prop] ?? "") === item} onMouseDown={(event) => event.preventDefault()} onClick={() => model.editStyle(prop, item)} />)}</div> : null;
  const action = (key: string, options: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => model.keyAction({ type: "ks-html-key", key, ctrl: false, alt: false, shift: false, ...options });
  const fontSize = Number.parseFloat(styles["font-size"] ?? "") || 16;
  const line = styles["line-height"] === "normal" ? "자동" : String(Number((Number.parseFloat(styles["line-height"] ?? "") / fontSize).toFixed(2)) || 0);
  const opacity = String(Math.round((Number.parseFloat(styles.opacity ?? "1") || 0) * 100));
  const backgroundImage = styles["background-image"] && styles["background-image"] !== "none" ? (styles["background-image"].includes("gradient(") ? "그라디언트" : "이미지") : undefined;
  const shadow = computedShadows[styles["box-shadow"] ?? ""] ?? Object.entries(shadows).find(([, css]) => css === styles["box-shadow"])?.[0] ?? "사용자 값";
  const textOptions = [{ label: "왼쪽", value: "left", icon: AlignLeft }, { label: "가운데", value: "center", icon: AlignCenter }, { label: "오른쪽", value: "right", icon: AlignRight }, { label: "양쪽", value: "justify", icon: AlignJustify }];
  const mainIcons = vertical ? [AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal, AlignVerticalSpaceBetween] : [AlignStartVertical, AlignCenterVertical, AlignEndVertical, AlignHorizontalSpaceBetween];
  const crossIcons = vertical ? [AlignStartVertical, AlignCenterVertical, AlignEndVertical] : [AlignStartHorizontal, AlignCenterHorizontal, AlignEndHorizontal];
  const mainOptions = ["flex-start", "center", "flex-end", "space-between"].map((item, index) => ({ label: ["주축 앞", "주축 가운데", "주축 뒤", "주축 양 끝"][index], value: item, icon: mainIcons[index] }));
  const crossOptions = ["flex-start", "center", "flex-end"].map((item, index) => ({ label: ["교차축 앞", "교차축 가운데", "교차축 뒤"][index], value: item, icon: crossIcons[index] }));
  const outsideColor = (target: HTMLElement) => !target.closest("[data-color], .ks-html-swatches");
  return <div className="ks-html-rail-body" onPointerDownCapture={() => { pointerDown.current = true; }} onPointerUpCapture={() => { pointerDown.current = false; }} onPointerCancelCapture={() => { pointerDown.current = false; }} onClickCapture={(event) => { if (outsideColor(event.target as HTMLElement)) setActiveColor(null); }} onFocusCapture={(event) => { if (!pointerDown.current && outsideColor(event.target as HTMLElement)) setActiveColor(null); }} onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) { pointerDown.current = false; setActiveColor(null); } }}>
    <Target selection={selection} choose={(n) => model.send({ type: "ks-html-select-number", n })} />
    <div className="ks-html-actions" role="toolbar" aria-label="요소">
      <IconButton aria-label="위로 Alt+↑" disabled={body || selection.first} onClick={() => action("ArrowUp", { alt: true })}><ArrowUp /></IconButton>
      <IconButton aria-label="아래로 Alt+↓" disabled={body || selection.last} onClick={() => action("ArrowDown", { alt: true })}><ArrowDown /></IconButton>
      <IconButton aria-label="복제 Ctrl+D" disabled={body} onClick={() => action("d", { ctrl: true })}><Copy /></IconButton>
      <IconButton aria-label="숨기기" disabled={body} pressed={display === "none"} onClick={() => { if (display === "none") model.editStyle("display", displayBefore.current.get(selection.n) ?? ""); else { displayBefore.current.set(selection.n, display); model.editStyle("display", "none"); } }}><EyeOff /></IconButton>
      <IconButton className="ks-html-danger" aria-label="삭제 Delete" disabled={body} onClick={() => action("Delete")}><Trash2 /></IconButton>
    </div>
    {group("글", !selection.hasChildren && Boolean(selection.text), <div className="ks-html-fields">
      {!selection.hasChildren ? <TextField value={selection.text ?? ""} change={model.editText} /> : null}
      {field("크기", "font-size", { min: 1 })}{field("굵기", "font-weight", { step: 100, min: 100, max: 900 })}
      {field("행간", "line-height", { value: line, step: 0.1, min: 0 })}{field("자간", "letter-spacing", { step: 0.1 })}
      <Alignment label="글 정렬" options={textOptions} value={styles["text-align"] === "start" ? "left" : styles["text-align"] ?? "left"} set={(next) => model.editStyle("text-align", next)} />{color("", "color")}{swatches("color")}
    </div>)}
    {group("채우기와 테두리", true, <div className="ks-html-fields">
      {color("배경", "background-color", "is-6", backgroundImage)}{swatches("background-color")}
      {color("테두리", "border-color", "is-4")}{field("두께", "border-width", { min: 0, span: "is-2" })}{swatches("border-color")}
      {field("모서리", "border-radius", { min: 0 })}{field("불투명", "opacity", { value: opacity, min: 0, max: 100, unit: "%" })}
      <Select className="ks-html-prop is-6" label="그림자" prefix={<span className="ks-html-prop-label">그림자</span>} groups={[{ options: [...Object.keys(shadows), ...(shadow === "사용자 값" ? [shadow] : [])].map((name) => ({ value: name, label: name })) }]} value={shadow} onChange={(next) => { if (typeof next === "string" && shadows[next]) model.editStyle("box-shadow", shadows[next]); }} />
    </div>)}
    {layout ? group("배치", true, <div className="ks-html-fields">
      <Alignment label="방향" options={[{ label: "가로", value: "row", icon: ArrowRight }, { label: "세로", value: "column", icon: ArrowDown }]} value={vertical ? "column" : "row"} set={(next) => model.editStyle(grid ? "grid-auto-flow" : "flex-direction", next)} />
      {field("gap", "gap", { min: 0 })}
      <Alignment label="주축" options={mainOptions} value={styles["justify-content"] === "normal" ? "flex-start" : styles["justify-content"] ?? "flex-start"} set={(next) => model.editStyle("justify-content", next)} />
      <Alignment label="교차축" options={crossOptions} value={styles["align-items"] ?? ""} set={(next) => model.editStyle("align-items", next)} />
    </div>) : null}
    {group("간격", true, <div className="ks-html-box" role="group" aria-label="간격">
      {field("바깥 위", "margin-top", { box: "is-top" })}{field("바깥 왼쪽", "margin-left", { box: "is-left" })}
      <div className="ks-html-box-inner">{field("안쪽 위", "padding-top", { min: 0, box: "is-top" })}{field("안쪽 왼쪽", "padding-left", { min: 0, box: "is-left" })}<div className="ks-html-box-core">{selection.rect?.width ?? 0} × {selection.rect?.height ?? 0}</div>{field("안쪽 오른쪽", "padding-right", { min: 0, box: "is-right" })}{field("안쪽 아래", "padding-bottom", { min: 0, box: "is-bottom" })}</div>
      {field("바깥 오른쪽", "margin-right", { box: "is-right" })}{field("바깥 아래", "margin-bottom", { box: "is-bottom" })}
    </div>)}
    {group("크기", false, <div className="ks-html-fields">{field("너비", "width", { value: value("width", String(selection.rect?.width ?? 0)), min: 0 })}{field("높이", "height", { value: value("height", String(selection.rect?.height ?? 0)), min: 0 })}</div>)}
  </div>;
}

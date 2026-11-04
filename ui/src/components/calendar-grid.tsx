import { useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { addDays, addMonths, addYears, dateObject, todayISO, weekStart } from "../blocks/input-date-time";
import { preserveWindowActionFocus } from "../share/action-context";
import { ownerOf } from "../share/overlay-owner";
import { DataIcon } from "./data-icons";
import { IconButton } from "./primitives";

type Props = { value: string | null; min: string | null; max: string | null; locale: string; anchor: HTMLElement; onChoose: (value: string) => void };
const clamp = (value: string, min: string | null, max: string | null) => min && value < min ? min : max && value > max ? max : value;
export function CalendarGrid({ value, min, max, locale, anchor, onChoose }: Props) {
  const today = todayISO();
  const [active, setActive] = useState(() => clamp(value ?? today, min, max));
  const activeRef = useRef<HTMLButtonElement>(null);
  const firstDay = weekStart(locale);
  const first = `${active.slice(0, 7)}-01`;
  const date = dateObject(first);
  const offset = (date.getUTCDay() - firstDay + 7) % 7;
  const end = dateObject(addMonths(first, 1)); end.setUTCDate(0);
  const days = end.getUTCDate();
  const title = new Intl.DateTimeFormat(locale, { timeZone: "UTC", calendar: "gregory", year: "numeric", month: "long" }).format(date);
  const full = new Intl.DateTimeFormat(locale, { timeZone: "UTC", calendar: "gregory", dateStyle: "full" });
  const weekday = new Intl.DateTimeFormat(locale, { timeZone: "UTC", weekday: "short" });
  const number = new Intl.NumberFormat(locale, { useGrouping: false });
  const localeInfo = new Intl.Locale(locale) as Intl.Locale & { getTextInfo?: () => { direction: string }; textInfo?: { direction: string } };
  const reverse = (localeInfo.getTextInfo?.() ?? localeInfo.textInfo)?.direction === "rtl";
  useLayoutEffect(() => {
    const owner = ownerOf(anchor);
    if (!owner || !preserveWindowActionFocus(owner)) activeRef.current?.focus({ preventScroll: true });
  }, [active, anchor]);
  const move = (next: string) => setActive(clamp(next, min, max));
  const next = addMonths(first, 1);
  const previousEnd = addDays(first, -1);
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.key === "Enter" || event.key === " ") && (!min || active >= min) && (!max || active <= max)) { event.preventDefault(); onChoose(active); return; }
    let nextValue: string | null = null;
    if (event.key === "ArrowLeft") nextValue = addDays(active, reverse ? 1 : -1);
    if (event.key === "ArrowRight") nextValue = addDays(active, reverse ? -1 : 1);
    if (event.key === "ArrowUp") nextValue = addDays(active, -7);
    if (event.key === "ArrowDown") nextValue = addDays(active, 7);
    if (event.key === "Home") nextValue = addDays(active, -((dateObject(active).getUTCDay() - firstDay + 7) % 7));
    if (event.key === "End") nextValue = addDays(active, 6 - ((dateObject(active).getUTCDay() - firstDay + 7) % 7));
    if (event.key === "PageUp") nextValue = event.shiftKey ? addYears(active, -1) : addMonths(active, -1);
    if (event.key === "PageDown") nextValue = event.shiftKey ? addYears(active, 1) : addMonths(active, 1);
    if (nextValue) { event.preventDefault(); move(nextValue); }
  };
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - offset + 1;
    if (day < 1 || day > days) return <div role="gridcell" key={index} />;
    const valueAt = `${first.slice(0, 8)}${String(day).padStart(2, "0")}`;
    const disabled = Boolean((min && valueAt < min) || (max && valueAt > max));
    return <div role="gridcell" aria-selected={valueAt === value} key={valueAt}>
      <button type="button" className="ks-icon-button ks-calendar-day" ref={valueAt === active ? activeRef : undefined} tabIndex={valueAt === active && !disabled ? 0 : -1} disabled={disabled} aria-label={full.format(dateObject(valueAt))} aria-current={valueAt === today ? "date" : undefined} onClick={() => onChoose(valueAt)}>{number.format(day)}</button>
    </div>;
  });
  return <>
    <div className="ks-calendar-header">
      <IconButton aria-label="이전 달" disabled={Boolean(min && previousEnd < min)} onClick={() => move(addMonths(active, -1))}><DataIcon name="chevron-left" size="inline" /></IconButton>
      <span aria-live="polite">{title}</span>
      <IconButton aria-label="다음 달" disabled={Boolean(max && next > max)} onClick={() => move(addMonths(active, 1))}><DataIcon name="chevron-right" size="inline" /></IconButton>
    </div>
    <div role="grid" aria-label={title} className="ks-calendar-grid" onKeyDown={keyDown}>
      <div role="row" className="ks-calendar-row">{Array.from({ length: 7 }, (_, index) => {
        const day = new Date(Date.UTC(2026, 10, 1 + ((firstDay + index) % 7)));
        return <div role="columnheader" key={index}>{weekday.format(day)}</div>;
      })}</div>
      {Array.from({ length: cells.length / 7 }, (_, index) => <div role="row" className="ks-calendar-row" key={index}>{cells.slice(index * 7, index * 7 + 7)}</div>)}
    </div>
  </>;
}

export type Parsed = { valid: true; value: string | null } | { valid: false };
const invalid: Parsed = { valid: false };
const pad = (value: number, length = 2) => String(value).padStart(length, "0");
const iso = (year: number, month: number, day: number) => `${pad(year, 4)}-${pad(month)}-${pad(day)}`;

function utcDate(year: number, month: number, day: number): Date {
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return date;
}
export function parseISODate(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1) return null;
  const date = utcDate(year, month, day);
  return date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day ? value : null;
}
export function parseISOTime(value: string): string | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match && Number(match[1]) < 24 && Number(match[2]) < 60 ? value : null;
}
export function dateObject(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return utcDate(year, month, day);
}
export function dateISO(date: Date): string { return iso(date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()); }
export function todayISO(): string { const d = new Date(); return iso(d.getFullYear(), d.getMonth() + 1, d.getDate()); }
export function addDays(value: string, days: number): string {
  const date = dateObject(value); date.setUTCDate(date.getUTCDate() + days); return dateISO(date);
}
export function addMonths(value: string, months: number): string {
  const date = dateObject(value), day = date.getUTCDate();
  date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + months);
  const end = new Date(date); end.setUTCMonth(end.getUTCMonth() + 1, 0);
  date.setUTCDate(Math.min(day, end.getUTCDate())); return dateISO(date);
}
export function addYears(value: string, years: number): string { return addMonths(value, years * 12); }
export function weekStart(locale: string): number {
  const info = new Intl.Locale(locale) as Intl.Locale & { getWeekInfo?: () => { firstDay: number }; weekInfo?: { firstDay: number } };
  return ((info.getWeekInfo?.() ?? info.weekInfo)?.firstDay ?? 7) % 7;
}
export function timeOptions(step: number, min: string | null, max: string | null): string[] {
  const options: string[] = [];
  for (let minutes = 0; minutes < 1440; minutes += step) {
    const value = `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
    if ((!min || value >= min) && (!max || value <= max)) options.push(value);
  }
  return options;
}
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
export function createDateTimeFormat(locale?: string) {
  const resolved = locale ?? new Intl.DateTimeFormat().resolvedOptions().locale;
  const dateFormatter = new Intl.DateTimeFormat(resolved, { timeZone: "UTC", calendar: "gregory", year: "numeric", month: "numeric", day: "numeric" });
  const timeFormatter = new Intl.DateTimeFormat(resolved, { timeZone: "UTC", hour: "numeric", minute: "2-digit" });
  const numbers = new Intl.NumberFormat(resolved, { useGrouping: false });
  const digits = Array.from({ length: 10 }, (_, index) => numbers.format(index));
  const ascii = (text: string) => Array.from(text).map((character) => { const index = digits.indexOf(character); return index < 0 ? character : String(index); }).join("").replace(/[\u200e\u200f\u061c]/g, "");
  const dateParts = dateFormatter.formatToParts(utcDate(2006, 11, 20));
  const order = dateParts.filter((part) => part.type === "year" || part.type === "month" || part.type === "day").map((part) => part.type);
  const datePattern = new RegExp(`^${dateParts.map((part, index) => {
    if (part.type === "year") return "(\\d{4})";
    if (part.type === "month" || part.type === "day") return "(\\d{1,2})";
    const literal = escapeRegex(ascii(part.value)).replace(/\s+/g, "\\s*");
    return index === dateParts.length - 1 ? `(?:${literal})?` : literal;
  }).join("")}$`);
  const periods = new Map<string, "am" | "pm">();
  for (let hour = 0; hour < 24; hour++) {
    const token = timeFormatter.formatToParts(utcDate(2026, 1, 1).setUTCHours(hour)).find((part) => part.type === "dayPeriod")?.value;
    if (token) periods.set(token.toLocaleLowerCase(resolved), hour < 12 ? "am" : "pm");
  }
  const parseDate = (text: string): Parsed => {
    const raw = ascii(text).trim();
    if (!raw) return { valid: true, value: null };
    const direct = parseISODate(raw);
    if (direct) return { valid: true, value: direct };
    const match = datePattern.exec(raw);
    if (!match) return invalid;
    const parts: Record<string, number> = {};
    order.forEach((key, index) => { parts[key] = Number(match[index + 1]); });
    const value = iso(parts.year, parts.month, parts.day);
    return parseISODate(value) ? { valid: true, value } : invalid;
  };
  const parseTime = (text: string): Parsed => {
    let raw = ascii(text).trim();
    if (!raw) return { valid: true, value: null };
    const direct = /^(\d{1,2}):(\d{2})$/.exec(raw);
    if (direct) {
      const value = `${pad(Number(direct[1]))}:${direct[2]}`;
      return parseISOTime(value) ? { valid: true, value } : invalid;
    }
    raw = raw.toLocaleLowerCase(resolved);
    for (const [token, period] of periods) {
      if (!raw.includes(token)) continue;
      const remaining = raw.replace(token, "").trim();
      const match = /^(\d{1,2})\s*:\s*(\d{2})$/.exec(remaining);
      if (!match) return invalid;
      const hour = Number(match[1]), minute = Number(match[2]);
      if (hour < 1 || hour > 12 || minute > 59) return invalid;
      return { valid: true, value: `${pad(hour % 12 + (period === "pm" ? 12 : 0))}:${pad(minute)}` };
    }
    return invalid;
  };
  return {
    locale: resolved, parseDate, parseTime,
    formatDate: (value: string | null) => value ? dateFormatter.formatToParts(dateObject(value)).map((part) => part.type === "year" ? part.value.padStart(4, digits[0]) : part.value).join("") : "",
    formatTime: (value: string | null) => { if (value === null) return ""; const [hour, minute] = value.split(":").map(Number); const date = utcDate(2026, 1, 1); date.setUTCHours(hour, minute); return timeFormatter.format(date); },
  };
}

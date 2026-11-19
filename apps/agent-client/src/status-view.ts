import type { Control } from "./reducer.ts";
import type { Limit } from "./status.ts";

const pad = (value: number): string => String(value).padStart(2, "0");

/** 다시 차는 시각. 오늘이면 `HH:MM`, 아니면 `M/D HH:MM`(로컬 시간대). */
export function formatReset(iso: string, now: Date): string {
  const date = new Date(iso);
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return date.toDateString() === now.toDateString() ? time : `${date.getMonth() + 1}/${date.getDate()} ${time}`;
}

/** 막힌 창이 먼저, 그다음 사용률이 큰 순. 사용률을 모르는 창은 뒤로 보낸다. */
export function tightestLimit(limits: Limit[]): Limit | null {
  const rank = (limit: Limit): number => limit.blocked ? 2 : limit.usedRatio === null ? -1 : limit.usedRatio;
  return limits.reduce<Limit | null>((best, limit) => best && rank(best) >= rank(limit) ? best : limit, null);
}

export function limitRow(limit: Limit, now: Date): { key: string; label: string; value: number; text: string; known: boolean } {
  const reset = limit.resetsAt ? formatReset(limit.resetsAt, now) : null;
  const base = { key: limit.id, label: limit.label };
  if (limit.blocked) return { ...base, value: 1, text: reset ? `막힘, ${reset}까지` : "막힘", known: true };
  if (limit.usedRatio === null) return { ...base, value: 0, text: "모름", known: false };
  const left = `${Math.round((1 - limit.usedRatio) * 100)}% 남음`;
  return { ...base, value: limit.usedRatio, text: reset ? `${left} (${reset})` : left, known: true };
}

/** 현재 값의 선택지 라벨. boolean은 켜졌을 때만 control 라벨을 낸다. */
export function controlLabel(control: Control): string | null {
  if (control.kind === "boolean") return control.value === true ? control.label : null;
  return control.options.find((option) => option.value === control.value)?.label ?? null;
}

import type { Control } from "./reducer.ts";
import type { Limit } from "./status.ts";

const MINUTE = 60_000, HOUR = 60 * MINUTE, DAY = 24 * HOUR;

/** 상태 줄 막대 자리. 창 id로 고정하고, 나머지 창은 설정에서만 보인다. */
const BAR_WINDOWS = [
  { id: "five_hour", key: "session" },
  { id: "seven_day", key: "weekly" },
] as const;

/** 남은 시간을 재는 단위. 하루 이상이면 일, 한 시간 이상이면 시간, 그 밖에는 분. */
const unitOf = (remaining: number): { size: number; suffix: string } =>
  remaining >= DAY ? { size: DAY, suffix: "일" } : remaining >= HOUR ? { size: HOUR, suffix: "시간" } : { size: MINUTE, suffix: "분" };

/** 다시 차기까지 남은 시간. 단위로 내리고 최소 1분이다. */
export function timeLeft(iso: string, now: Date): string {
  const remaining = new Date(iso).getTime() - now.getTime(), unit = unitOf(remaining);
  return `${Math.max(1, Math.floor(remaining / unit.size))}${unit.suffix} 남음`;
}

/** 다시 차는 시각이 지난 창은 다시 찬 것으로 본다. 막힘을 풀고 사용률은 다음 이벤트가 올 때까지 모름으로 둔다. */
export function limitsAt(limits: Limit[], now: Date): Limit[] {
  return limits.map((limit) => limit.resetsAt && new Date(limit.resetsAt).getTime() <= now.getTime() ? { ...limit, usedRatio: null, blocked: false } : limit);
}

/**
 * 보이는 창(막혔거나 사용률을 아는 창)의 남은 시간 글이 처음 달라지는 가장 이른 시각(ms). 없으면 null.
 * 남은 시간이 단위의 배수와 같을 때는 아직 같은 글이므로 경계를 1ms 지난 때다. 1분이 안 남으면 다시 찬 직후다.
 */
export function nextRedraw(limits: Limit[], now: Date): number | null {
  const times = limits.flatMap((limit) => {
    if (!limit.resetsAt || (!limit.blocked && limit.usedRatio === null)) return [];
    const reset = new Date(limit.resetsAt).getTime(), remaining = reset - now.getTime();
    if (remaining <= 0) return [];
    const { size } = unitOf(remaining);
    return [reset - Math.floor(remaining / size) * size + 1];
  });
  return times.length ? Math.min(...times) : null;
}

/** 창 하나의 막대 값과 짧은 글(「58%」, 「막힘」), 남은 시간. 사용률을 모르면 null. */
function reading(limit: Limit, now: Date): { value: number; text: string; left: string | null } | null {
  const left = limit.resetsAt ? timeLeft(limit.resetsAt, now) : null;
  if (limit.blocked) return { value: 1, text: "막힘", left };
  if (limit.usedRatio === null) return null;
  return { value: limit.usedRatio, text: `${Math.round(limit.usedRatio * 100)}%`, left };
}

/** 설정의 한도 행. 「58% 사용, 3시간 남음」, 「막힘, 3시간 남음」, 「아직 모름」. */
export function limitRow(limit: Limit, now: Date): { key: string; label: string; value: number; text: string; known: boolean } {
  const base = { key: limit.id, label: limit.label }, read = reading(limit, now);
  if (!read) return { ...base, value: 0, text: "아직 모름", known: false };
  const head = limit.blocked ? read.text : `${read.text} 사용`;
  return { ...base, value: read.value, text: read.left ? `${head}, ${read.left}` : head, known: true };
}

/** 상태 줄의 session, weekly 막대. 창이 없거나 사용률을 모르면 그 막대를 뺀다. */
export function limitBars(limits: Limit[], now: Date): { key: string; label: string; value: number; text: string; left: string | null }[] {
  return BAR_WINDOWS.flatMap(({ id, key }) => {
    const limit = limits.find((candidate) => candidate.id === id), read = limit && reading(limit, now);
    return read ? [{ key, label: key, ...read }] : [];
  });
}

/** 현재 값의 선택지 라벨. boolean은 켜졌을 때만 control 라벨을 낸다. */
export function controlLabel(control: Control): string | null {
  if (control.kind === "boolean") return control.value === true ? control.label : null;
  return control.options.find((option) => option.value === control.value)?.label ?? null;
}

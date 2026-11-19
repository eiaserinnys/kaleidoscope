export type Limit = { id: string; label: string; usedRatio: number | null; resetsAt: string | null; blocked: boolean };
export type Account = { label: string; email: string | null };

const LIMIT_LABELS: Record<string, string> = {
  five_hour: "5시간",
  seven_day: "7일",
  seven_day_opus: "Opus 7일",
  seven_day_sonnet: "Sonnet 7일",
  seven_day_overage_included: "7일(추가 사용 포함)",
  overage: "추가 사용",
};

type Window = { status?: unknown; utilization?: unknown; resetsAt?: unknown };

function readWindow(id: string, window: Window): Limit {
  // utilization 단위: 0~1(2026-11-19 실제 usage_update 이벤트로 확인). 범위 밖이나 유한하지 않은 값은 모름으로 둔다.
  const { utilization, resetsAt } = window;
  return {
    id,
    label: LIMIT_LABELS[id] ?? id,
    usedRatio: typeof utilization === "number" && utilization >= 0 && utilization <= 1 ? utilization : null,
    resetsAt: typeof resetsAt === "number" && Number.isFinite(resetsAt) ? new Date(resetsAt * 1000).toISOString() : null,
    blocked: window.status === "rejected",
  };
}

/**
 * SDKRateLimitInfo(`_claude/rateLimit`, prompt 오류의 data.rateLimit)를 한도 창 목록으로 읽는다.
 * `unifiedWindows`에 창마다 사용률이 오고, 맨 위는 이번 이벤트를 일으킨 창(`rateLimitType`) 하나다.
 * 맨 위 창이 막혔으면 같은 id의 창도 막힌 것으로 보고, `unifiedWindows`에 없으면 뒤에 더한다.
 */
export function readClaudeRateLimits(info: unknown): Limit[] {
  const value = (typeof info === "object" && info !== null ? info : {}) as Window & { rateLimitType?: unknown; unifiedWindows?: unknown };
  const unified = typeof value.unifiedWindows === "object" && value.unifiedWindows !== null ? value.unifiedWindows as Record<string, Window> : {};
  const limits = Object.entries(unified)
    .filter(([, window]) => typeof window === "object" && window !== null)
    .map(([id, window]) => readWindow(id, window));
  const id = value.rateLimitType;
  if (typeof id !== "string" || id === "") return limits;
  const top = readWindow(id, value);
  return limits.some((limit) => limit.id === id)
    ? limits.map((limit) => limit.id === id ? { ...limit, blocked: limit.blocked || top.blocked } : limit)
    : [...limits, top];
}

/** 같은 창은 갱신하고 새 창은 뒤에 쌓는다. 같은 주기(resetsAt)의 사용률 모름 갱신은 알던 사용률을 지킨다. */
export function mergeLimit(limits: Limit[], next: Limit): Limit[] {
  const known = (limit: Limit): Limit => next.usedRatio === null && next.resetsAt === limit.resetsAt ? { ...next, usedRatio: limit.usedRatio } : next;
  return limits.some((limit) => limit.id === next.id)
    ? limits.map((limit) => limit.id === next.id ? known(limit) : limit)
    : [...limits, next];
}

/** `auth/status_update`에서 현재 계정을 읽는다. 인증되지 않았거나 계정이 없으면 null. */
export function readAuthStatus(params: unknown): Account | null {
  const value = params as { state?: unknown; accounts?: unknown } | null | undefined;
  if (value?.state !== "authenticated" || !Array.isArray(value.accounts)) return null;
  const accounts = value.accounts as Record<string, unknown>[];
  const account = accounts.find((a) => a?.active === true) ?? accounts[0];
  if (!account || typeof account.label !== "string") return null;
  return { label: account.label, email: typeof account.email === "string" ? account.email : null };
}

export function isSubagentTool(update: unknown): boolean {
  const name = (update as { _meta?: { claudeCode?: { toolName?: unknown } } } | null | undefined)?._meta?.claudeCode?.toolName;
  return name === "Agent" || name === "Task";
}

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

/** SDKRateLimitInfo(`_claude/rateLimit`, prompt 오류의 data.rateLimit)를 한도 창 하나로 읽는다. */
export function readClaudeRateLimit(info: unknown): Limit | null {
  const value = info as Record<string, unknown> | null | undefined;
  const id = value?.rateLimitType;
  if (typeof id !== "string" || id === "") return null;
  // utilization 단위: 0~1로 가정(미확인, 실제 이벤트로 확인 예정)
  const utilization = value?.utilization;
  const resetsAt = value?.resetsAt;
  return {
    id,
    label: LIMIT_LABELS[id] ?? id,
    usedRatio: typeof utilization === "number" ? utilization : null,
    resetsAt: typeof resetsAt === "number" ? new Date(resetsAt * 1000).toISOString() : null,
    blocked: value?.status === "rejected",
  };
}

export function mergeLimit(limits: Limit[], next: Limit): Limit[] {
  return limits.some((limit) => limit.id === next.id)
    ? limits.map((limit) => limit.id === next.id ? next : limit)
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

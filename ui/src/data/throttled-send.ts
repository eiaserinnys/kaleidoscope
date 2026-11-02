export interface ThrottledSend<T> {
  send(value: T): void;
  flush(): void;
}

export function createSerialSend<T>(send: (value: T) => Promise<unknown> | unknown): (value: T, options: { coalesce: boolean }) => void {
  let active = false;
  const pending: Array<{ value: T; coalesce: boolean }> = [];

  const drain = () => {
    if (active || pending.length === 0) return;
    const { value } = pending.shift()!;
    active = true;
    let result: Promise<unknown> | unknown;
    try {
      result = send(value);
    } catch {
      active = false;
      drain();
      return;
    }
    void Promise.resolve(result).catch(() => undefined).then(() => {
      active = false;
      drain();
    });
  };

  return (value, { coalesce }) => {
    const last = pending.at(-1);
    if (coalesce && last?.coalesce) last.value = value;
    else pending.push({ value, coalesce });
    drain();
  };
}

export function createThrottledSend<T>(send: (value: T) => void, intervalMs: number): ThrottledSend<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hasPending = false;
  let pending!: T;

  const startCooldown = () => {
    timer = setTimeout(() => {
      if (!hasPending) { timer = null; return; }
      hasPending = false;
      send(pending);
      startCooldown();
    }, intervalMs);
  };

  const flush = () => {
    // Keep the current cooldown so a release cannot create a second send inside the interval.
    if (!hasPending || timer !== null) return;
    hasPending = false;
    send(pending);
    startCooldown();
  };

  return {
    send(value) {
      if (timer === null) {
        send(value);
        startCooldown();
      } else {
        pending = value;
        hasPending = true;
      }
    },
    flush,
  };
}

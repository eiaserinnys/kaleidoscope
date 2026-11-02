export interface ThrottledSend<T> {
  send(value: T): void;
  flush(): void;
}

export function createThrottledSend<T>(send: (value: T) => void, intervalMs: number): ThrottledSend<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hasPending = false;
  let pending!: T;

  const flush = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (!hasPending) return;
    hasPending = false;
    send(pending);
  };

  return {
    send(value) {
      if (timer === null) {
        send(value);
        timer = setTimeout(() => {
          timer = null;
          if (!hasPending) return;
          hasPending = false;
          send(pending);
        }, intervalMs);
      } else {
        pending = value;
        hasPending = true;
      }
    },
    flush,
  };
}

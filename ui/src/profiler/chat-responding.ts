const active = new Set<string>();

export function markResponding(key: string, on: boolean): void {
  if (on) active.add(key);
  else active.delete(key);
}

export function isResponding(): boolean {
  return active.size > 0;
}

/** 앵커에서 대상까지의 순서를 보존한다. */
export function selectionRange(keys: readonly string[], anchor: string | null, target: string): string[] {
  const end = keys.indexOf(target);
  if (end < 0) return [];
  const start = keys.indexOf(anchor ?? "");
  const origin = start < 0 ? end : start;
  const step = origin <= end ? 1 : -1;
  const result: string[] = [];
  for (let index = origin; index !== end + step; index += step) result.push(keys[index]);
  return result;
}

export function toggleSelection(keys: readonly string[], key: string): string[] {
  return keys.includes(key) ? keys.filter((item) => item !== key) : [...keys, key];
}

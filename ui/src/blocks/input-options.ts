export type InputOption = { value: string; label: string; description?: string; index: number; searchValue: string; searchLabel: string };

export function normalizeInputOptions(value: unknown): { ok: true; options: InputOption[] } | { ok: false; index: number } {
  if (!Array.isArray(value)) return { ok: false, index: 1 };
  const options: InputOption[] = [];
  for (const [index, entry] of value.entries()) {
    let option: { value: string; label: string; description?: string };
    if (typeof entry === "string") option = { value: entry, label: entry };
    else if (entry && typeof entry === "object" && !Array.isArray(entry) && typeof entry.value === "string" && typeof entry.label === "string" && (entry.description === undefined || typeof entry.description === "string")) option = entry;
    else return { ok: false, index: index + 1 };
    options.push({ ...option, index, searchValue: option.value.toLowerCase(), searchLabel: option.label.toLowerCase() });
  }
  return { ok: true, options };
}

export function filterInputOptions(options: InputOption[], query: string): InputOption[] {
  const normalized = query.toLowerCase();
  return normalized ? options.filter((option) => option.searchValue.includes(normalized) || option.searchLabel.includes(normalized)) : options;
}

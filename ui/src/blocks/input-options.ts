import * as shellErrors from "../contract/shell-errors";

export type InputOption = { value: string; label: string; description?: string; index: number; searchValue: string; searchLabel: string };

export type InputOptionsFailure = { ok: false; reason: "ARRAY_INVALID" | "ITEM_INVALID" | "KEY_MISSING" | "KEY_NOT_STRING"; index: number; key: string; received: string };

export function normalizeInputOptions(value: unknown): { ok: true; options: InputOption[] } | InputOptionsFailure {
  const failure = (reason: InputOptionsFailure["reason"], received: unknown, index = 1, key = ""): InputOptionsFailure => ({ ok: false, reason, index, key, received: (JSON.stringify(received) ?? "undefined").slice(0, 120) });
  if (!Array.isArray(value)) return failure("ARRAY_INVALID", value);
  const options: InputOption[] = [];
  for (const [index, entry] of value.entries()) {
    let option: { value: string; label: string; description?: string };
    if (typeof entry === "string") option = { value: entry, label: entry };
    else {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) return failure("ITEM_INVALID", entry, index + 1);
      for (const key of ["value", "label", "description"]) {
        if (!(key in entry)) {
          if (key === "description") continue;
          return failure("KEY_MISSING", undefined, index + 1, key);
        }
        if (typeof entry[key] !== "string") return failure("KEY_NOT_STRING", entry[key], index + 1, key);
      }
      option = entry;
    }
    options.push({ ...option, index, searchValue: option.value.toLowerCase(), searchLabel: option.label.toLowerCase() });
  }
  return { ok: true, options };
}

export function filterInputOptions(options: InputOption[], query: string): InputOption[] {
  const normalized = query.toLowerCase();
  return normalized ? options.filter((option) => option.searchValue.includes(normalized) || option.searchLabel.includes(normalized)) : options;
}

export function resolveInputOption(options: InputOption[], text: string): string | null {
  const value = options.find((option) => option.value === text);
  if (value) return value.value;
  const key = text.trim().toLowerCase();
  return options.find((option) => option.searchValue === key || option.searchLabel === key)?.value ?? null;
}

export function inputOptionsError(failure: InputOptionsFailure) {
  const args = { index: String(failure.index), key: failure.key, received: failure.received };
  switch (failure.reason) {
    case "ARRAY_INVALID": return shellErrors.SHELL_INPUT_OPTIONS_ARRAY_INVALID(args);
    case "ITEM_INVALID": return shellErrors.SHELL_INPUT_OPTIONS_ITEM_INVALID(args);
    case "KEY_MISSING": return shellErrors.SHELL_INPUT_OPTIONS_KEY_MISSING(args);
    case "KEY_NOT_STRING": return shellErrors.SHELL_INPUT_OPTIONS_KEY_NOT_STRING(args);
  }
}

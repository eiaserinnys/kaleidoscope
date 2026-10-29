export function normalizeWebAddress(input: string): string {
  const value = input.trim();
  if (/^https?:\/\//i.test(value)) return value;
  if (!/\s/.test(value) && (value.includes(".") || value.toLowerCase().startsWith("localhost"))) {
    return `https://${value}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(value)}`;
}

export function isHttpAddress(value: unknown): value is string {
  if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

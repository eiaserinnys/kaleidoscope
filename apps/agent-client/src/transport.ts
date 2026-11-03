/** NDJSON uses byte boundaries, so an incomplete UTF-8 sequence stays in the checkpoint. */
export function decodeLines(partial: number[], bytes: Uint8Array): { messages: unknown[]; partial: number[] } {
  const combined = new Uint8Array(partial.length + bytes.length);
  combined.set(partial);
  combined.set(bytes, partial.length);
  const messages: unknown[] = [];
  let start = 0;
  for (let i = 0; i < combined.length; i++) {
    if (combined[i] !== 10) continue;
    const line = combined.subarray(start, i);
    if (line.length) messages.push(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)));
    start = i + 1;
  }
  return { messages, partial: Array.from(combined.subarray(start)) };
}

export function encodeMessage(message: unknown): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(message)}\n`);
}

import type { AppCommentAnchor, AppDefinition, Block } from "../contract/contract";
import { normalizeBlock } from "../render/render-block";

export type DefinitionEntry = { type: string; own_fingerprint: string; parent_child_types: string[]; meaningful: boolean; empty_fingerprint: string };
export type DefinitionIndex = Map<string, DefinitionEntry>;
export type DefinitionResult = { kind: "exact" | "moved"; pointer: string } | { kind: "orphan" };

type Child = { path: string; block: Block };
const escapePointer = (part: string) => part.replace(/~/g, "~0").replace(/\//g, "~1");
function children(block: Block): Child[] {
  switch (block.type) {
    case "split": case "stack": return block.children.map((child, i) => ({ path: `children/${i}`, block: child }));
    case "toolbar": return [...block.start.map((child, i) => ({ path: `start/${i}`, block: child })), ...(block.end ?? []).map((child, i) => ({ path: `end/${i}`, block: child }))];
    case "tabs": return block.tabs.map((tab, i) => ({ path: `tabs/${i}/child`, block: tab.child }));
    case "section": return [...(block.actions ?? []).map((child, i) => ({ path: `actions/${i}`, block: child })), { path: "child", block: block.child }];
    case "when": case "dialog": case "anchor": return [{ path: "child", block: block.child }];
    case "repeat": return [{ path: "template", block: block.template }];
    case "chat": return block.footer ? [{ path: "footer", block: block.footer }] : [];
    case "button": return block.preview ? [{ path: "preview", block: block.preview }] : [];
    default: return [];
  }
}
function ownFields(block: Block, descendants: Child[]): Record<string, unknown> {
  const copy = structuredClone(block) as unknown as Record<string, unknown>;
  for (const { path } of descendants) {
    const segments = path.split("/"); let current: any = copy;
    for (const part of segments.slice(0, -1)) current = current?.[part];
    if (current && !Array.isArray(current)) delete current[segments.at(-1)!];
  }
  // Array slots consisting of blocks are removed as a whole; tab metadata stays.
  for (const field of ["children", "start", "end", "actions"]) if (Array.isArray(copy[field]) && ["split", "stack", "toolbar", "section"].includes(block.type)) delete copy[field];
  return copy;
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v === undefined ? null : v)).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  return JSON.stringify(value) ?? "null";
}
async function hash(value: unknown): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical(value)));
  return `sha256:${Array.from(new Uint8Array(bytes), (v) => v.toString(16).padStart(2, "0")).join("")}`;
}
export async function buildDefinitionIndex(definition: AppDefinition): Promise<{ digest: string; entries: DefinitionIndex }> {
  const entries: DefinitionIndex = new Map();
  const walk = async (raw: Block, pointer: string, siblings: string[]) => {
    const block = normalizeBlock(raw); const nested = children(block); const own = ownFields(block, nested);
    entries.set(pointer, { type: block.type, own_fingerprint: await hash(own), parent_child_types: siblings, meaningful: Object.keys(own).some((key) => key !== "type"), empty_fingerprint: await hash({ type: block.type }) });
    const childTypes = nested.map(({ block: child }) => normalizeBlock(child).type);
    for (const child of nested) await walk(child.block, `${pointer}/${child.path.split("/").map(escapePointer).join("/")}`, childTypes);
  };
  await walk(definition.ui, "/ui", [normalizeBlock(definition.ui).type]);
  return { digest: await hash(definition), entries };
}
export function resolveDefinition(anchor: AppCommentAnchor, createdDigest: string, index: DefinitionIndex, currentDigest: string): DefinitionResult {
  const pointer = anchor.pointer; const current = pointer ? index.get(pointer) : undefined;
  if (createdDigest === currentDigest) return current && current.type === anchor.normalized_type ? { kind: "exact", pointer: pointer! } : { kind: "orphan" };
  if (anchor.kind === "point") return { kind: "orphan" };
  if (!anchor.own_fingerprint || !anchor.normalized_type) return { kind: "orphan" };
  const typeEntry = [...index.values()].find((entry) => entry.type === anchor.normalized_type);
  if (!typeEntry || anchor.own_fingerprint === typeEntry.empty_fingerprint) return { kind: "orphan" };
  const sameSiblings = (entry: DefinitionEntry) => JSON.stringify(entry.parent_child_types) === JSON.stringify(anchor.parent_child_types);
  const allMatches = [...index].filter(([, entry]) => entry.own_fingerprint === anchor.own_fingerprint && entry.type === anchor.normalized_type);
  const matches = allMatches.filter(([, entry]) => entry.meaningful);
  if (current && current.meaningful && current.own_fingerprint === anchor.own_fingerprint && current.type === anchor.normalized_type && (matches.length === 1 || sameSiblings(current))) return { kind: "exact", pointer: pointer! };
  if (matches.length === 1) return { kind: "moved", pointer: matches[0][0] };
  if (!allMatches.length && current && current.type === anchor.normalized_type && sameSiblings(current)) return { kind: "exact", pointer: pointer! };
  return { kind: "orphan" };
}

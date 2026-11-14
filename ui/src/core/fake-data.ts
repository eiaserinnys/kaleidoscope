import jsonata from "jsonata";
import type { Actions, AppDefinition, AppWindow, Binding, BindingMore, BindingValue, Block, DataView, SourceStatus } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";
import { BLOCK_SLOTS } from "../contract/block-slots";

export interface FakePageSeed { value?: JsonValue; error?: string; id?: string; delayMs?: number }
export interface FakeSourceSeed { value?: JsonValue; error?: string; login?: string; delayMs?: number; waitForFirstPage?: () => Promise<void>; pages?: FakePageSeed[] }
export interface FakeDataSeed { sources?: Record<string, FakeSourceSeed>; callError?: string }
type Context = { window: AppWindow; definition: AppDefinition; view: DataView; values: Record<string, JsonValue>; inputs: Record<string, string>; pages: Record<string, { next: number; received: number; more?: BindingMore }>; timers: Array<ReturnType<typeof setInterval>>; attached: boolean };

function appendPage(current: JsonValue, incoming: JsonValue | undefined, path: string): JsonValue {
  const copy = structuredClone(current);
  const keys = path ? path.split(".") : [];
  const get = (value: JsonValue | undefined) => keys.reduce<JsonValue | undefined>((item, key) => item && typeof item === "object" && !Array.isArray(item) ? item[key] : undefined, value);
  const target = get(copy), extra = get(incoming);
  if (Array.isArray(target) && Array.isArray(extra)) target.push(...extra);
  return copy;
}

/// 자리 경로의 `*`를 값의 배열로 펼친다. 값이 없으면 빈 목록이다.
function walkSlotPath(value: JsonValue | undefined, segments: string[]): Array<{ path: string[]; value: JsonValue }> {
  const [head, ...rest] = segments;
  if (head === undefined) return value === undefined ? [] : [{ path: [], value }];
  if (head === "*") {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item, index) => walkSlotPath(item, rest).map((hit) => ({ path: [String(index), ...hit.path], value: hit.value })));
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return walkSlotPath(value[head], rest).map((hit) => ({ path: [head, ...hit.path], value: hit.value }));
}

function slotValues(root: JsonValue, slots: string[]): Array<[string, JsonValue]> {
  return slots.flatMap((slot) => walkSlotPath(root, slot.split("/"))
    .filter((hit) => hit.value !== undefined && hit.value !== null)
    .map((hit): [string, JsonValue] => [`/${hit.path.join("/")}`, hit.value]));
}

function isBlockValue(value: JsonValue): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value) && typeof value["type"] === "string";
}

/// 블록 종류마다 생성 표가 정한 자식 자리를 따라 바로 아래 블록을 모은다.
function childBlocks(block: Block, pointer: string): Array<[string, Block]> {
  const root = block as unknown as JsonValue;
  return (BLOCK_SLOTS[block.type]?.children ?? []).flatMap((slot) => slotValues(root, [slot])
    .filter(([, value]) => isBlockValue(value))
    .map(([path, value]): [string, Block] => [`${pointer}${path}`, value as unknown as Block]));
}

function actionSlots(block: Block, pointer = "/ui"): Set<string> {
  const slots = new Set<string>();
  for (const [path] of slotValues(block as unknown as JsonValue, BLOCK_SLOTS[block.type]?.actions ?? [])) slots.add(`${pointer}${path}`);
  for (const [childPointer, child] of childBlocks(block, pointer)) {
    for (const slot of actionSlots(child, childPointer)) slots.add(slot);
  }
  return slots;
}

function expressionSlots(block: Block, pointer = "/ui"): Array<[string, Binding]> {
  const slots = slotValues(block as unknown as JsonValue, BLOCK_SLOTS[block.type]?.bindings ?? [])
    .map(([path, value]): [string, Binding] => [`${pointer}${path}`, value as Binding]);
  return slots.concat(childBlocks(block, pointer).flatMap(([path, child]) => expressionSlots(child, path)));
}

function expression(binding: Binding): string | undefined {
  return binding !== null && typeof binding === "object" && !Array.isArray(binding) && Object.keys(binding).length === 1 && "expr" in binding && typeof binding.expr === "string" ? binding.expr : undefined;
}

async function evaluate(binding: Binding, context: Context, event?: JsonValue, item?: JsonValue): Promise<JsonValue> {
  const expr = expression(binding);
  if (expr !== undefined) return (await jsonata(expr).evaluate({}, { state: context.window.state, data: context.values, event, item }) ?? null) as JsonValue;
  if (binding !== null && typeof binding === "object" && !Array.isArray(binding) && Object.keys(binding).length === 1 && "state" in binding && typeof binding.state === "string") return context.window.state[binding.state] ?? null;
  return binding as JsonValue;
}

function pointerValue(definition: AppDefinition, pointer: string): unknown {
  return pointer.split("/").slice(1).reduce<unknown>((value, key) => value && typeof value === "object" ? (value as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")] : undefined, definition);
}

export function createFakeData(seed: FakeDataSeed, getWindow: (id: string) => AppWindow, getDefinition: (window: AppWindow) => AppDefinition | undefined, setState: (id: string, state: AppWindow["state"]) => Promise<void>, emit: (id: string, view: DataView) => void) {
  const attached = new Map<string, Context>();
  const publish = (context: Context, view: DataView) => { if (context.attached) emit(context.window.id, view); };
  const sourceInputs = async (context: Context, name: string) => {
    const source = context.definition.sources![name];
    const path = source.kind === "store" ? undefined : source.kind === "folder" ? source.dir : source.path;
    const query = source.kind === "request" ? source.query ?? {} : {};
    return JSON.stringify([path === undefined ? "" : await evaluate(path, context), await Promise.all(Object.entries(query).map(async ([key, value]) => [key, await evaluate(value, context)]))]);
  };
  const recalculate = async (context: Context) => {
    const changed: DataView["values"] = {};
    for (const [pointer, binding] of [...expressionSlots(context.definition.ui), ...(context.definition.storage?.entries.flatMap((entry, index): Array<[string, Binding]> => entry.choices === undefined ? [] : [[`/storage/entries/${index}/choices`, entry.choices]]) ?? [])]) {
      const expr = expression(binding);
      if (expr === undefined) continue;
      const names = [...expr.matchAll(/\$data\.([a-z][a-z0-9_]*)/g)].map((match) => match[1]);
      const missing = names.filter((name) => !Object.hasOwn(context.values, name));
      const statuses = missing.map((name) => context.view.sources[name]).filter(Boolean);
      const login = statuses.find((status) => status.state === "login_required");
      const failed = statuses.find((status) => status.state === "failed");
      let value: BindingValue;
      if (login?.state === "login_required") value = { status: "login_required", permission: login.permission };
      else if (failed?.state === "failed") value = { status: "failed", message: failed.message, retry: missing.filter((name) => context.view.sources[name]?.state === "failed") };
      else if (statuses.some((status) => status.state === "loading")) value = { status: "loading" };
      else {
        try { value = { status: "ready", value: await evaluate(binding, context) }; }
        catch (error) { value = { status: "failed", message: error instanceof Error ? error.message : String(error), retry: [] }; }
      }
      const paged = [...new Set(names)].filter((name) => context.definition.sources?.[name]?.kind === "request" && context.pages[name]);
      if (value.status === "ready" && paged.length === 1 && context.pages[paged[0]].more) value.more = context.pages[paged[0]].more;
      if (JSON.stringify(context.view.values[pointer]) !== JSON.stringify(value)) { context.view.values[pointer] = value; changed[pointer] = value; }
    }
    return changed;
  };
  const refresh = async (context: Context, requested: string[]) => {
    const names = requested.length ? requested : Object.keys(context.definition.sources ?? {});
    await Promise.all(names.map(async (name) => {
      const source = context.definition.sources?.[name];
      if (!source) return;
      const sourceSeed = seed.sources?.[name] ?? {};
      const path = source.kind === "store" ? undefined : source.kind === "folder" ? source.dir : source.path;
      if (path !== undefined && await evaluate(path, context) === null) {
        context.view.sources[name] = { state: "idle" }; delete context.values[name];
      } else {
        context.view.sources[name] = { state: "loading", has_value: Object.hasOwn(context.values, name) };
      }
      publish(context, { sources: { [name]: context.view.sources[name] }, values: await recalculate(context) });
      if (context.view.sources[name].state === "idle") return;
      if (sourceSeed.waitForFirstPage) await sourceSeed.waitForFirstPage();
      else if (sourceSeed.delayMs) await new Promise((resolve) => setTimeout(resolve, sourceSeed.delayMs));
      if (!context.attached) return;
      const hasValue = Object.hasOwn(context.values, name);
      let status: SourceStatus;
      if (sourceSeed.login) status = { state: "login_required", permission: sourceSeed.login };
      else if (sourceSeed.error) status = { state: "failed", message: sourceSeed.error, has_value: hasValue };
      else {
        context.values[name] = structuredClone(sourceSeed.pages?.[0]?.value ?? sourceSeed.value ?? null);
        if (source.kind === "request" && source.page && sourceSeed.pages) {
          const previous = context.pages[name];
          let received = 1;
          let next = 1;
          while (previous && received < previous.received && next < previous.next) {
            const previousPage = sourceSeed.pages[next++];
            if (previousPage && !previousPage.error) {
              context.values[name] = appendPage(context.values[name], previousPage.value, source.page.items ?? "");
              received++;
            }
          }
          context.pages[name] = { next, received, more: next < sourceSeed.pages.length ? { source: name, state: "ready", retry: false } : undefined };
        }
        status = { state: "ready", updated_at: new Date().toISOString() };
      }
      context.view.sources[name] = status;
      publish(context, { sources: { [name]: status }, values: await recalculate(context) });
    }));
  };
  return {
    async attach(id: string) {
      const window = getWindow(id); const definition = getDefinition(window);
      if (!definition) throw { code: "not_found", message: "앱 정의를 찾을 수 없습니다", details: [] };
      const context: Context = { window, definition, view: { sources: {}, values: {} }, values: {}, inputs: {}, pages: {}, timers: [], attached: true };
      attached.set(id, context);
      for (const [name, source] of Object.entries(definition.sources ?? {})) {
        context.inputs[name] = await sourceInputs(context, name);
        context.view.sources[name] = { state: "loading", has_value: false };
        if ("refresh_secs" in source && source.refresh_secs) context.timers.push(setInterval(() => { if ((context.pages[name]?.received ?? 0) < 2) void refresh(context, [name]); }, source.refresh_secs * 1000));
      }
      await recalculate(context);
      const view = structuredClone(context.view);
      void refresh(context, []);
      return view;
    },
    read(id: string) {
      const context = attached.get(id);
      if (!context) throw { code: "not_found", message: "이 창의 데이터 연결이 끝나 현재 값을 읽을 수 없습니다. 창을 다시 열어 주세요.", details: [] };
      return { state: structuredClone(getWindow(id).state), view: structuredClone(context.view) };
    },
    detach(id: string) { const context = attached.get(id); if (context) { context.attached = false; context.timers.forEach(clearInterval); attached.delete(id); } },
    async stateChanged(window: AppWindow) {
      const context = attached.get(window.id); if (!context) return;
      context.window = window;
      const changed: string[] = [];
      for (const name of Object.keys(context.definition.sources ?? {})) {
        const input = await sourceInputs(context, name);
        if (context.inputs[name] !== input) { context.inputs[name] = input; delete context.pages[name]; delete context.values[name]; changed.push(name); }
      }
      publish(context, { sources: {}, values: await recalculate(context) });
      if (changed.length) await refresh(context, changed);
    },
    async refresh(id: string, names: string[]) { const context = attached.get(id); if (!context) throw { code: "not_found", message: "연결된 데이터가 없습니다", details: [] }; await refresh(context, names); },
    async more(id: string, name: string) {
      const context = attached.get(id); const paging = context?.pages[name];
      const source = context?.definition.sources?.[name];
      const pages = seed.sources?.[name]?.pages;
      if (!context || !paging || !pages || source?.kind !== "request" || !source.page || paging.more?.state === "loading" || !paging.more || paging.next >= pages.length) return false;
      paging.more = { source: name, state: "loading", retry: false };
      publish(context, { sources: {}, values: await recalculate(context) });
      const result = pages[paging.next++];
      void (async () => {
        if (result.delayMs) await new Promise((resolve) => setTimeout(resolve, result.delayMs));
        if (!context.attached) return;
        if (result.error) paging.more = { source: name, state: "failed", message: result.error, id: result.id, retry: true };
        else {
          context.values[name] = appendPage(context.values[name], result.value, source.page!.items ?? "");
          paging.received++;
          paging.more = paging.next < pages.length ? { source: name, state: "ready", retry: false } : undefined;
        }
        publish(context, { sources: {}, values: await recalculate(context) });
      })();
      return true;
    },
    async act(id: string, pointer: string, event: JsonValue, item?: JsonValue) {
      const context = attached.get(id); if (!context) throw { code: "not_found", message: "연결된 데이터가 없습니다", details: [] };
      if (!actionSlots(context.definition.ui).has(pointer)) throw { code: "invalid_request", message: "명령을 처리할 수 없습니다.", details: [] };
      const actions = pointerValue(context.definition, pointer) as Actions | undefined;
      if (!actions) throw { code: "not_found", message: "동작을 찾을 수 없습니다", details: [] };
      const list = Array.isArray(actions) ? actions : [actions];
      for (const action of list) {
        if ("set_state" in action) {
          const value = "value" in action && action.value !== undefined ? await evaluate(action.value, context, event, item) : event;
          await setState(id, { [action.set_state]: value });
        } else if ("refresh" in action) await refresh(context, action.refresh);
        else if (seed.callError) throw { code: "server", message: seed.callError, details: [] };
      }
    },
  };
}

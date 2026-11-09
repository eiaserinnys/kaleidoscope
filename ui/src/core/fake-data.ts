import jsonata from "jsonata";
import type { Actions, AppDefinition, AppWindow, Binding, BindingMore, BindingValue, Block, DataView, SourceStatus } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";

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

function childBlocks(block: Block, pointer: string): Array<[string, Block]> {
  switch (block.type) {
    case "split": case "stack": return block.children.map((child, index) => [`${pointer}/children/${index}`, child]);
    case "tabs": return block.tabs.map((tab, index) => [`${pointer}/tabs/${index}/child`, tab.child]);
    case "toolbar": return [...block.start.map((child, index): [string, Block] => [`${pointer}/start/${index}`, child]), ...(block.end ?? []).map((child, index): [string, Block] => [`${pointer}/end/${index}`, child])];
    case "section": return [...(block.actions ?? []).map((child, index): [string, Block] => [`${pointer}/actions/${index}`, child]), [`${pointer}/child`, block.child]];
    case "when": return [[`${pointer}/child`, block.child]];
    case "dialog": return [[`${pointer}/child`, block.child]];
    default: return [];
  }
}

function actionSlots(block: Block, pointer = "/ui"): Set<string> {
  const slots = new Set<string>();
  const add = (field: string, present = true) => { if (present) slots.add(`${pointer}/${field}`); };
  if ("item_menu" in block) block.item_menu?.forEach((_, index) => add(`item_menu/${index}/on_select`));
  switch (block.type) {
    case "button_grid": add("on_press"); break;
    case "timeline": for (const field of ["on_select", "on_edit", "on_viewport"] as const) add(field, block[field] !== undefined); break;
    case "tree": if (block.items !== undefined) { add("on_select", block.on_select !== undefined); add("on_check", block.on_check !== undefined); } break;
    case "folder": add("on_select", block.on_select !== undefined); break;
    case "list": add("on_select", block.on_select !== undefined); add("on_activate", block.on_activate !== undefined); add("on_remove", block.on_remove !== undefined); block.group_actions?.forEach((_, index) => add(`group_actions/${index}/on_click`)); break;
    case "map": case "chart": case "table": case "feed": add("on_select", block.on_select !== undefined); break;
    case "input": add("on_change"); add("on_submit", block.on_submit !== undefined); add("on_cancel", block.on_cancel !== undefined); break;
    case "text": add("on_click", block.on_click !== undefined); add("on_double_click", block.on_double_click !== undefined); break;
    case "select": case "toggle": case "slider": case "color": add("on_change"); break;
    case "button": add("on_click"); break;
    case "dialog": add("on_close"); add("on_confirm", block.on_confirm !== undefined); break;
    case "notice": (block.actions ?? []).forEach((_, index) => add(`actions/${index}/on_click`)); break;
  }
  for (const [childPointer, child] of childBlocks(block, pointer)) {
    for (const slot of actionSlots(child, childPointer)) slots.add(slot);
  }
  return slots;
}

function expressionSlots(block: Block, pointer = "/ui"): Array<[string, Binding]> {
  const slots: Array<[string, Binding]> = [];
  const add = (name: string, value: Binding | undefined) => { if (value !== undefined) slots.push([`${pointer}/${name}`, value]); };
  switch (block.type) {
    case "section": add("title", block.title); add("meta", block.meta); break;
    case "list": add("items", block.items); add("current", block.current); break;
    case "stack": add("scroll_reset", block.scroll_reset); break;
    case "tree": if (block.items !== undefined) add("items", block.items); break;
    case "table": add("rows", block.rows); if (!Array.isArray(block.columns)) add("columns", block.columns); break;
    case "properties": block.fields.forEach((field, index) => add(`fields/${index}/value`, field.value)); break;
    case "feed": add("entries", block.entries); break;
    case "repeat": add("items", block.items); break;
    case "text": case "code": add("value", block.value); break;
    case "markdown": case "html_view": case "sandbox": add("value", block.value); break;
    case "select": add("options", block.options); break;
    case "input": add("min", block.min); add("max", block.max); add("step", block.step); add("focus", block.focus); add("options", block.options); break;
    case "progress": add("value", block.value); add("label", block.label); break;
    case "button": add("disabled", block.disabled); add("confirm/body", block.confirm?.body); break;
    case "chat": add("loading", block.loading); break;
    case "image": case "media": add("src", block.src); break;
    case "metrics": add("items", block.items); break;
    case "button_grid": add("buttons", block.buttons); break;
    case "chart": add("series", block.series); break;
    case "timeline":
      for (const name of ["duration", "position", "tracks", "markers", "ticks", "selection", "snap", "viewport", "off_days"] as const) add(name, block[name]);
      break;
    case "map": add("points", block.points); break;
  }
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

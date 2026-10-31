import jsonata from "jsonata";
import type { Action, Actions, AppDefinition, AppWindow, Binding, BindingValue, Block, DataView, SourceStatus } from "../contract/contract";
import type { JsonValue } from "../contract/serde_json/JsonValue";

export interface FakeSourceSeed { value?: JsonValue; error?: string; login?: string; delayMs?: number }
export interface FakeDataSeed { sources?: Record<string, FakeSourceSeed>; callError?: string }
type Context = { window: AppWindow; definition: AppDefinition; view: DataView; values: Record<string, JsonValue>; inputs: Record<string, string>; timers: Array<ReturnType<typeof setInterval>>; attached: boolean };

function childBlocks(block: Block, pointer: string): Array<[string, Block]> {
  switch (block.type) {
    case "split": case "stack": return block.children.map((child, index) => [`${pointer}/children/${index}`, child]);
    case "tabs": return block.tabs.map((tab, index) => [`${pointer}/tabs/${index}/child`, tab.child]);
    case "toolbar": return [...block.start.map((child, index): [string, Block] => [`${pointer}/start/${index}`, child]), ...(block.end ?? []).map((child, index): [string, Block] => [`${pointer}/end/${index}`, child])];
    case "section": return [[`${pointer}/child`, block.child]];
    default: return [];
  }
}

function expressionSlots(block: Block, pointer = "/ui"): Array<[string, Binding]> {
  const slots: Array<[string, Binding]> = [];
  const add = (name: string, value: Binding | undefined) => { if (value !== undefined) slots.push([`${pointer}/${name}`, value]); };
  switch (block.type) {
    case "section": add("title", block.title); add("meta", block.meta); break;
    case "list": case "tree": add("items", block.items); break;
    case "table": add("rows", block.rows); break;
    case "properties": block.fields.forEach((field, index) => add(`fields/${index}/value`, field.value)); break;
    case "feed": add("entries", block.entries); break;
    case "text": case "code_view": add("value", block.value); break;
    case "select": add("options", block.options); break;
    case "button": add("disabled", block.disabled); add("confirm/body", block.confirm?.body); break;
    case "image": case "media": add("src", block.src); break;
    case "metrics": add("items", block.items); break;
    case "keypad": add("buttons", block.buttons); break;
    case "chart": add("series", block.series); break;
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
    const path = source.kind === "folder" ? source.dir : source.path;
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
      const path = source.kind === "folder" ? source.dir : source.path;
      if (path !== undefined && await evaluate(path, context) === null) {
        context.view.sources[name] = { state: "idle" }; delete context.values[name];
      } else {
        context.view.sources[name] = { state: "loading", has_value: Object.hasOwn(context.values, name) };
      }
      publish(context, { sources: { [name]: context.view.sources[name] }, values: await recalculate(context) });
      if (context.view.sources[name].state === "idle") return;
      if (sourceSeed.delayMs) await new Promise((resolve) => setTimeout(resolve, sourceSeed.delayMs));
      if (!context.attached) return;
      const hasValue = Object.hasOwn(context.values, name);
      let status: SourceStatus;
      if (sourceSeed.login) status = { state: "login_required", permission: sourceSeed.login };
      else if (sourceSeed.error) status = { state: "failed", message: sourceSeed.error, has_value: hasValue };
      else { context.values[name] = sourceSeed.value ?? null; status = { state: "ready", updated_at: new Date().toISOString() }; }
      context.view.sources[name] = status;
      publish(context, { sources: { [name]: status }, values: await recalculate(context) });
    }));
  };
  return {
    async attach(id: string) {
      const window = getWindow(id); const definition = getDefinition(window);
      if (!definition) throw { code: "not_found", message: "앱 정의를 찾을 수 없습니다", details: [] };
      const context: Context = { window, definition, view: { sources: {}, values: {} }, values: {}, inputs: {}, timers: [], attached: true };
      attached.set(id, context);
      for (const [name, source] of Object.entries(definition.sources ?? {})) {
        context.inputs[name] = await sourceInputs(context, name);
        context.view.sources[name] = { state: "loading", has_value: false };
        if (source.refresh_secs) context.timers.push(setInterval(() => { void refresh(context, [name]); }, source.refresh_secs * 1000));
      }
      await recalculate(context);
      const view = structuredClone(context.view);
      void refresh(context, []);
      return view;
    },
    detach(id: string) { const context = attached.get(id); if (context) { context.attached = false; context.timers.forEach(clearInterval); attached.delete(id); } },
    async stateChanged(window: AppWindow) {
      const context = attached.get(window.id); if (!context) return;
      context.window = window;
      const changed: string[] = [];
      for (const name of Object.keys(context.definition.sources ?? {})) {
        const input = await sourceInputs(context, name);
        if (context.inputs[name] !== input) { context.inputs[name] = input; changed.push(name); }
      }
      publish(context, { sources: {}, values: await recalculate(context) });
      if (changed.length) await refresh(context, changed);
    },
    async refresh(id: string, names: string[]) { const context = attached.get(id); if (!context) throw { code: "not_found", message: "연결된 데이터가 없습니다", details: [] }; await refresh(context, names); },
    async act(id: string, pointer: string, event: JsonValue, item?: JsonValue) {
      const context = attached.get(id); if (!context) throw { code: "not_found", message: "연결된 데이터가 없습니다", details: [] };
      const actions = pointerValue(context.definition, pointer) as Actions | undefined;
      if (!actions) throw { code: "not_found", message: "동작을 찾을 수 없습니다", details: [] };
      const list: Action[] = Array.isArray(actions) ? actions : [actions];
      for (const action of list) {
        if ("set_state" in action) {
          const value = "value" in action && action.value !== undefined ? await evaluate(action.value, context, event, item) : event;
          await setState(id, { ...context.window.state, [action.set_state]: value });
        } else if ("refresh" in action) await refresh(context, action.refresh);
        else if (seed.callError) throw { code: "server", message: seed.callError, details: [] };
      }
    },
  };
}

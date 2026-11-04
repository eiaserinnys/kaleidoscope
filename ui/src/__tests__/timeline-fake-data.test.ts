import { expect, it } from "vitest";
import { waitFor } from "@testing-library/react";
import type { AppDefinition, BindingValue } from "../contract/contract";
import { createFakeTransport } from "../core/fake-transport";
import { makeTestSeed } from "./fixtures";

it("시험 코어가 시간축의 모든 식 바인딩 값을 전달한다", async () => {
  const sample = { tracks: [], markers: [], off_days: ["2026-12-25"], viewport: { start: "2026-11-01", end: "2026-11-30" }, selection: { ids: [] }, duration: 10, position: 0, ticks: [], snap: null };
  const definition: AppDefinition = { id: "timeline-bindings", name: "시간축", requires: { blocks: 29, modules: {} }, permissions: [], state: {},
    sources: { sample: { kind: "request", permission: "sample", path: "/sample" } },
    ui: { type: "timeline", tracks: [], ...Object.fromEntries(Object.keys(sample).map((name) => [name, { expr: `$data.sample.${name}` }])) } };
  const transport = createFakeTransport({ ...makeTestSeed({ definitions: [definition] }), data: { sources: { sample: { value: sample } } } });
  const values: Record<string, BindingValue> = {};
  const unsubscribe = transport.subscribe((event) => { if (event.event === "data.update") Object.assign(values, event.view.values); });
  const reply = await transport.call({ op: "data.attach", window_id: "viewer-window" });
  if (reply.op === "data.attach") Object.assign(values, reply.view.values);
  await waitFor(() => { for (const [name, value] of Object.entries(sample)) expect(values[`/ui/${name}`]).toEqual({ status: "ready", value }); });
  unsubscribe();
  await transport.call({ op: "data.detach", window_id: "viewer-window" });
});

it("시험 코어가 시간축 선택·편집·범위 동작을 전달한다", async () => {
  const definition: AppDefinition = { id: "timeline-actions", name: "시간축", requires: { blocks: 33, modules: {} }, permissions: [], state: { selected: null, edited: null, viewed: null },
    ui: { type: "timeline", scale: "dates", tracks: [], on_select: { set_state: "selected" }, on_edit: { set_state: "edited" }, on_viewport: { set_state: "viewed" } } };
  const transport = createFakeTransport(makeTestSeed({ definitions: [definition] }));
  await transport.call({ op: "data.attach", window_id: "viewer-window" });
  for (const field of ["on_select", "on_edit", "on_viewport"]) {
    await expect(transport.call({ op: "data.act", window_id: "viewer-window", pointer: `/ui/${field}`, event: { value: field } })).resolves.toEqual(expect.objectContaining({ op: "data.act" }));
  }
  const reply = await transport.call({ op: "state.get" });
  if (reply.op !== "state.get") throw new Error("시험 상태 응답이 없습니다");
  expect(reply.snapshot.shared.windows.find((window) => window.id === "viewer-window")!.state).toEqual(expect.objectContaining({ selected: { value: "on_select" }, edited: { value: "on_edit" }, viewed: { value: "on_viewport" } }));
  await transport.call({ op: "data.detach", window_id: "viewer-window" });
});

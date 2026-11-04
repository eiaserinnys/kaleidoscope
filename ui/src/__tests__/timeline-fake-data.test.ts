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

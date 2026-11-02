import { describe, expect, it } from "vitest";
import type { ConversationModel } from "../contract/contract";
import { executionPlaces, keepStartModel, pickModel, placeIdOf } from "../blocks/agent-chat-places";

const models: ConversationModel[] = [
  { id: "a", label: "Shared", available: false, reason: "Limit", group: { id: "place-a", label: "Place A" } },
  { id: "a2", label: "Ready", available: true, group: { id: "place-a", label: "Place A" } },
  { id: "b", label: "Shared", available: true, group: { id: "place-b", label: "Place B" } },
  { id: "c", label: "Blocked", available: false, reason: "Unavailable", group: { id: "place-c", label: "Place C" } },
  { id: "other", label: "Other", available: true },
];

describe("execution places", () => {
  it("groups in first-seen order, including ungrouped models as one Other place", () => {
    expect(executionPlaces(models)).toEqual([
      { id: "place-a", label: "Place A", models: models.slice(0, 2), available: true },
      { id: "place-b", label: "Place B", models: [models[2]], available: true },
      { id: "place-c", label: "Place C", models: [models[3]], available: false },
      { id: "", label: "기타", models: [models[4]], available: true },
    ]);
    expect(placeIdOf(models[4])).toBe("");
  });

  it("prefers the same available model label, then the first available model", () => {
    expect(pickModel(executionPlaces(models)[1], "Shared")?.id).toBe("b");
    expect(pickModel(executionPlaces(models)[0], "Shared")?.id).toBe("a2");
    expect(pickModel(executionPlaces(models)[0], "missing")?.id).toBe("a2");
    expect(pickModel(executionPlaces(models)[2])?.id).toBeUndefined();
  });

  it("keeps the previous place on profile change when possible, otherwise uses the new start", () => {
    expect(keepStartModel(models, "b", models[0])).toBe("a2");
    expect(keepStartModel(models, "a2", models[2])).toBe("b");
    expect(keepStartModel([models[2]], "b", models[1])).toBe("b");
    expect(keepStartModel([models[2]], null, models[1])).toBe(null);
    expect(keepStartModel(models, "a2", undefined)).toBe("a2");
  });

  it("does not create an execution place selector for a single place", () => {
    expect(executionPlaces(models.slice(0, 2))).toHaveLength(1);
  });
});

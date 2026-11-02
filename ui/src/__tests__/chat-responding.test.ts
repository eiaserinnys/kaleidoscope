import { afterEach, describe, expect, it } from "vitest";
import { isResponding, markResponding } from "../profiler/chat-responding";

afterEach(() => {
  markResponding("test-a", false);
  markResponding("test-b", false);
});

describe("chat responding state", () => {
  it("remains active until all mounted conversations are idle", () => {
    markResponding("test-a", true);
    markResponding("test-b", true);
    expect(isResponding()).toBe(true);
    markResponding("test-a", false);
    expect(isResponding()).toBe(true);
    markResponding("test-b", false);
    expect(isResponding()).toBe(false);
  });
});

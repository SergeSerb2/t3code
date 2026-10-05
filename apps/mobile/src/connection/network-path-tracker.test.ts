import { describe, expect, it } from "@effect/vitest";
import { createNetworkPathTracker } from "./network-path-tracker";

describe("network path initialization", () => {
  it("wakes for a listener event before the initial snapshot and ignores the stale snapshot", () => {
    const tracker = createNetworkPathTracker<"wifi" | "cellular">();
    expect(tracker.record("cellular")).toBe(true);
    tracker.seed("wifi");
    expect(tracker.record("cellular")).toBe(false);
    expect(tracker.record("wifi")).toBe(true);
  });
  it("avoids a redundant wakeup after a matching initial snapshot", () => {
    const tracker = createNetworkPathTracker<"wifi" | "cellular">();
    tracker.seed("wifi");
    expect(tracker.record("wifi")).toBe(false);
    expect(tracker.record(undefined)).toBe(false);
    expect(tracker.record("cellular")).toBe(true);
  });
});

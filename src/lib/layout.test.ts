import { describe, expect, it } from "vitest";
import {
  clampSplit,
  defaultLayoutPreferences,
  parseLayoutPreferences,
  slotCount,
} from "./layout";

describe("presenter layout preferences", () => {
  it("defaults to the existing triple-left workspace", () => {
    const preferences = defaultLayoutPreferences();

    expect(preferences.kind).toBe("triple-left");
    expect(preferences.assignments["triple-left"]).toEqual(["current", "next", "notes"]);
    expect(preferences.splits["triple-left"]).toBe(70);
  });

  it("repairs malformed and duplicate persisted assignments", () => {
    const preferences = parseLayoutPreferences(JSON.stringify({
      kind: "double",
      assignments: { double: ["notes", "notes", "unknown"] },
      splits: { double: 99 },
    }));

    expect(preferences.kind).toBe("double");
    expect(preferences.assignments.double).toEqual(["notes", "current"]);
    expect(preferences.splits.double).toBe(75);
  });

  it("falls back safely when storage is corrupt", () => {
    expect(parseLayoutPreferences("not json")).toEqual(defaultLayoutPreferences());
    expect(clampSplit(Number.NaN)).toBe(50);
    expect(slotCount("single")).toBe(1);
  });
});

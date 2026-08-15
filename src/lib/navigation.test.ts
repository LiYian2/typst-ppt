import { describe, expect, it } from "vitest";
import { actionForKey, navigate } from "./navigation";

describe("presentation navigation", () => {
  it("never moves outside the physical PDF pages", () => {
    expect(navigate(0, 5, { type: "previous" })).toBe(0);
    expect(navigate(4, 5, { type: "next" })).toBe(4);
    expect(navigate(2, 5, { type: "go", page: 99 })).toBe(4);
  });

  it("uses familiar presentation keys", () => {
    expect(actionForKey(" ")).toEqual({ type: "next" });
    expect(actionForKey("PageUp")).toEqual({ type: "previous" });
    expect(actionForKey("Home")).toEqual({ type: "first" });
    expect(actionForKey("x")).toBeNull();
  });
});

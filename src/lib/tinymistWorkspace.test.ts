import { describe, expect, it, vi } from "vitest";
import { TinymistWorkspace } from "./tinymistWorkspace";

describe("Tinymist workspace definition navigation", () => {
  it("delegates an unopened include URI to the host editor", async () => {
    const openUri = vi.fn(() => null);
    const workspace = new TinymistWorkspace({ connected: false } as never, openUri);

    const result = await workspace.displayFile("file:///deck/includes/theme.typ");

    expect(result).toBeNull();
    expect(openUri).toHaveBeenCalledWith("file:///deck/includes/theme.typ");
  });
});

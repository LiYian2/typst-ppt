import { describe, expect, it, vi } from "vitest";
import { PREVIEW_SYNC_DELAYS_MS, replayPreviewPageSync } from "./tinymistPreviewSync";

describe("Tinymist preview page synchronization", () => {
  it("replays the current page across the iframe data-plane startup window", () => {
    const callbacks: Array<() => void> = [];
    const delays: number[] = [];
    const cancelled: number[] = [];
    const sync = vi.fn();
    const cleanup = replayPreviewPageSync(
      sync,
      (callback, delayMs) => {
        callbacks.push(callback);
        delays.push(delayMs);
        return callbacks.length;
      },
      (timer) => cancelled.push(timer as number),
    );

    callbacks.forEach((callback) => callback());
    expect(delays).toEqual(PREVIEW_SYNC_DELAYS_MS);
    expect(delays.at(-1)).toBeGreaterThanOrEqual(1_500);
    expect(sync).toHaveBeenCalledTimes(PREVIEW_SYNC_DELAYS_MS.length);

    cleanup();
    expect(cancelled).toHaveLength(PREVIEW_SYNC_DELAYS_MS.length);
  });
});

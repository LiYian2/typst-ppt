export const PREVIEW_SYNC_DELAYS_MS = [0, 150, 400, 900, 1_800] as const;

export function replayPreviewPageSync<TimerId>(
  sync: () => void,
  schedule: (callback: () => void, delayMs: number) => TimerId,
  cancel: (timer: TimerId) => void,
): () => void {
  const timers = PREVIEW_SYNC_DELAYS_MS.map((delayMs) => schedule(sync, delayMs));
  return () => timers.forEach(cancel);
}

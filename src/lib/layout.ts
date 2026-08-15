export const LAYOUT_KINDS = ["single", "double", "triple-left", "triple-right"] as const;
export const PANE_CONTENTS = ["current", "next", "notes"] as const;

export type LayoutKind = (typeof LAYOUT_KINDS)[number];
export type PaneContent = (typeof PANE_CONTENTS)[number];

export interface LayoutPreferences {
  kind: LayoutKind;
  assignments: Record<LayoutKind, PaneContent[]>;
  splits: Record<LayoutKind, number>;
}

const SLOT_COUNTS: Record<LayoutKind, number> = {
  single: 1,
  double: 2,
  "triple-left": 3,
  "triple-right": 3,
};

const DEFAULT_ASSIGNMENTS: Record<LayoutKind, PaneContent[]> = {
  single: ["current"],
  double: ["current", "notes"],
  "triple-left": ["current", "next", "notes"],
  "triple-right": ["next", "notes", "current"],
};

const DEFAULT_SPLITS: Record<LayoutKind, number> = {
  single: 100,
  double: 62,
  "triple-left": 70,
  "triple-right": 30,
};

export function defaultLayoutPreferences(): LayoutPreferences {
  return {
    kind: "triple-left",
    assignments: cloneAssignments(DEFAULT_ASSIGNMENTS),
    splits: { ...DEFAULT_SPLITS },
  };
}

export function parseLayoutPreferences(raw: string | null): LayoutPreferences {
  const defaults = defaultLayoutPreferences();
  if (!raw) return defaults;

  try {
    const value = JSON.parse(raw) as Partial<LayoutPreferences>;
    const kind = isLayoutKind(value.kind) ? value.kind : defaults.kind;
    const assignments = cloneAssignments(DEFAULT_ASSIGNMENTS);
    const splits = { ...DEFAULT_SPLITS };

    for (const layoutKind of LAYOUT_KINDS) {
      assignments[layoutKind] = normaliseAssignment(
        value.assignments?.[layoutKind],
        layoutKind,
      );
      splits[layoutKind] = clampSplit(value.splits?.[layoutKind] ?? splits[layoutKind]);
    }

    return { kind, assignments, splits };
  } catch {
    return defaults;
  }
}

export function clampSplit(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(75, Math.max(25, Math.round(value)));
}

export function slotCount(kind: LayoutKind): number {
  return SLOT_COUNTS[kind];
}

function normaliseAssignment(value: unknown, kind: LayoutKind): PaneContent[] {
  if (!Array.isArray(value)) return [...DEFAULT_ASSIGNMENTS[kind]];

  const expected = SLOT_COUNTS[kind];
  const chosen: PaneContent[] = [];
  for (const item of value) {
    if (isPaneContent(item) && !chosen.includes(item)) chosen.push(item);
    if (chosen.length === expected) break;
  }
  for (const fallback of DEFAULT_ASSIGNMENTS[kind]) {
    if (!chosen.includes(fallback)) chosen.push(fallback);
    if (chosen.length === expected) break;
  }
  for (const fallback of PANE_CONTENTS) {
    if (!chosen.includes(fallback)) chosen.push(fallback);
    if (chosen.length === expected) break;
  }
  return chosen;
}

function cloneAssignments(
  assignments: Record<LayoutKind, PaneContent[]>,
): Record<LayoutKind, PaneContent[]> {
  return Object.fromEntries(
    LAYOUT_KINDS.map((kind) => [kind, [...assignments[kind]]]),
  ) as Record<LayoutKind, PaneContent[]>;
}

function isLayoutKind(value: unknown): value is LayoutKind {
  return typeof value === "string" && LAYOUT_KINDS.includes(value as LayoutKind);
}

function isPaneContent(value: unknown): value is PaneContent {
  return typeof value === "string" && PANE_CONTENTS.includes(value as PaneContent);
}

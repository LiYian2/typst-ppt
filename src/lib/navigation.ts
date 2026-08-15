export type NavigationAction =
  | { type: "previous" }
  | { type: "next" }
  | { type: "first" }
  | { type: "last" }
  | { type: "go"; page: number };

export function navigate(current: number, pageCount: number, action: NavigationAction): number {
  if (pageCount <= 0) return 0;

  const last = pageCount - 1;
  switch (action.type) {
    case "previous":
      return Math.max(0, current - 1);
    case "next":
      return Math.min(last, current + 1);
    case "first":
      return 0;
    case "last":
      return last;
    case "go":
      return Math.max(0, Math.min(last, action.page));
  }
}

export function actionForKey(key: string): NavigationAction | null {
  if (["ArrowLeft", "ArrowUp", "PageUp"].includes(key)) return { type: "previous" };
  if (["ArrowRight", "ArrowDown", "PageDown", " "].includes(key)) return { type: "next" };
  if (key === "Home") return { type: "first" };
  if (key === "End") return { type: "last" };
  return null;
}

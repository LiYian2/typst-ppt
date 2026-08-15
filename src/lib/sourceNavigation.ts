/** A zero-based UTF-16 position as used by the Language Server Protocol. */
export type LspPosition = readonly [line: number, character: number];

/**
 * The source range sent by Tinymist's preview navigation notification.
 *
 * `filepath` is intentionally kept as an opaque path. The caller decides how
 * it maps the path to the active editor document (included files are valid).
 */
export interface SourceJump {
  filepath: string;
  start: LspPosition | null;
  end: LspPosition | null;
}

/** A CodeMirror-compatible selection with the source file it belongs to. */
export interface SourceSelection {
  filepath: string;
  from: number;
  to: number;
}

interface LineSpan {
  start: number;
  end: number;
}

/**
 * Convert an LSP UTF-16 position to a JavaScript/CodeMirror string offset.
 *
 * JavaScript strings and CodeMirror offsets are also UTF-16 code-unit based,
 * so the position can be applied directly after clamping it to the requested
 * line. Invalid positions and line numbers return `null`; a character beyond
 * the line's end is clamped to that end. CRLF line endings are treated as one
 * line break and the carriage return is excluded from the line's range.
 */
export function lspPositionToOffset(source: string, position: LspPosition | null | undefined): number | null {
  if (!position || !Number.isInteger(position[0]) || !Number.isInteger(position[1])) return null;

  const [line, character] = position;
  if (line < 0 || character < 0) return null;

  const lines = lineSpans(source);
  const span = lines[line];
  if (!span) return null;

  return span.start + Math.min(character, span.end - span.start);
}

/**
 * Map a Tinymist source jump to a CodeMirror selection.
 *
 * Tinymist may omit either endpoint for a point navigation event. In that
 * case the available endpoint is used for both sides. Reversed ranges are
 * normalized so callers can dispatch them without additional checks.
 */
export function sourceJumpToSelection(source: string, jump: SourceJump | null | undefined): SourceSelection | null {
  if (!jump || typeof jump.filepath !== "string" || jump.filepath.trim() === "") return null;

  const start = jump.start ?? jump.end;
  const end = jump.end ?? jump.start;
  if (!start || !end) return null;

  const startOffset = lspPositionToOffset(source, start);
  const endOffset = lspPositionToOffset(source, end);
  if (startOffset === null || endOffset === null) return null;

  return {
    filepath: jump.filepath,
    from: Math.min(startOffset, endOffset),
    to: Math.max(startOffset, endOffset),
  };
}

/**
 * Validate a Tinymist preview URL before placing it in an iframe.
 *
 * Only an explicit HTTP port on localhost or 127.0.0.1 is accepted. The
 * preview currently serves from its root path; rejecting other paths avoids
 * turning the desktop webview into a generic local-network browser.
 */
export function isAllowedTinymistPreviewUrl(value: string): boolean {
  return normalizeTinymistPreviewUrl(value) !== null;
}

/**
 * Return a canonical safe Tinymist preview URL, or `null` when it is unsafe.
 * The explicit port is retained even for port 80 so the result remains a
 * useful allow-listed URL for the Tauri CSP.
 */
export function normalizeTinymistPreviewUrl(value: string): string | null {
  if (typeof value !== "string" || value.trim() !== value || value === "") return null;

  // Require an explicit numeric port and keep the path/query/fragment grammar
  // constrained before handing the value to URL's parser.
  const match = value.match(/^http:\/\/(localhost|127\.0\.0\.1):([0-9]+)(?:[/?#][\s\S]*)?$/i);
  if (!match) return null;

  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return null;
  }

  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== match[1].toLowerCase() ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.pathname !== "/"
  ) {
    return null;
  }

  return `http://${parsed.hostname}:${port}/${parsed.search}${parsed.hash}`;
}

function lineSpans(source: string): LineSpan[] {
  const spans: LineSpan[] = [];
  let lineStart = 0;

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "\n") continue;

    const lineEnd = index > lineStart && source[index - 1] === "\r" ? index - 1 : index;
    spans.push({ start: lineStart, end: lineEnd });
    lineStart = index + 1;
  }

  spans.push({ start: lineStart, end: source.length });
  return spans;
}

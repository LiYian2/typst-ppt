# ADR-0003: Tinymist editing workspace with a separate preview path

- Status: accepted
- Date: 2026-08-16

## Context

The built-in source editor added in v0.1.3 uses a small custom Typst tokenizer,
static completions, compiler diagnostics, and the same PDF preview as presenter
view. It cannot provide Tinymist language intelligence or navigate from rendered
content to the source that produced it. PDF compilation is also the wrong
feedback loop for an editor preview when Tinymist already provides a faster,
source-mapped Web/SVG preview.

ADR-0001 selected PDF.js for consistent desktop presentation rendering, and
ADR-0002 requires a failed build to preserve the last good PDF. Those guarantees
remain important for presenter and audience view even when the editing workspace
has a newer, transient source buffer.

## Decision

Run one local `tinymist lsp` process for the active deck and connect it to the
CodeMirror editor through a generic JSON-RPC transport owned by the Tauri Rust
backend. Use Tinymist diagnostics, completions, hover, semantic tokens, source
navigation, and other supported language-server capabilities in the editing
workspace.

Start Tinymist's built-in Web/SVG preview through that same LSP session. Embed
the official localhost preview in slide mode and handle
`tinymist/preview/scrollSource` notifications as source jumps, including jumps
to included files.

Keep the existing Typst CLI, revisioned PDF output, PDF.js rendering, pdfpc
speaker-note query, and last-good-build behavior for presenter and audience
view. Tinymist is optional and editor-only; its absence or failure must not
replace or blank the last good PDF.

Release packaging pins Tinymist v0.15.2 when a sidecar is bundled. Development
and fallback resolution may use `TINYMIST_PATH`, `PATH`, and common platform
install locations. Preview networking is restricted to loopback HTTP and
WebSocket addresses and does not introduce a cloud dependency.

## Consequences

- The editing workspace gets fast source-mapped preview and real Typst language
  intelligence without reimplementing Tinymist.
- Presenter and audience rendering stay deterministic and isolated from
  transient editor state.
- The application has two intentional rendering paths with different safety
  contracts; code and documentation must not treat the editor preview as the
  presentation artifact.
- Tinymist process lifecycle, LSP framing, UTF-16 positions, localhost content
  security, and version compatibility become explicit application concerns.
- Full VS Code workbench parity is not a goal. The transport is generic, while
  v0.2.0 exposes the language features that have useful CodeMirror interactions.

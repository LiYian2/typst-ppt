# Typst Presenter

A cross-platform presenter console and optional Tinymist-powered editing
workspace for Typst decks. The presenter and audience windows keep using the
last good PDF, while the editor gets a fast source-mapped Web/SVG preview.

## MVP features

- Watches the whole deck directory for source and asset changes.
- Compiles revisioned PDFs with the local Typst CLI.
- Automatically expands the Typst project root when a deck references assets in
  a parent directory.
- Keeps the last good PDF visible when the current source has errors.
- Reads Touying `#speaker-note[...]` content from pdfpc metadata.
- Detects Touying side-by-side second-screen PDFs and shows only the slide half;
  scripts stay in the private notes panel and never reach the audience window.
- Provides current/next previews, notes, timer, slide navigation, and keyboard
  controls in the presenter view.
- Opens a separate audience window and can hand the current PDF to the operating
  system's default viewer.
- Provides an audience-safe editing mode backed by the complete Tinymist LSP:
  diagnostics, completions, hover, definition navigation, formatting,
  references, rename, signature help, and semantic highlighting.
- Embeds Tinymist's slide-only Web/SVG preview in the editor and maps preview
  clicks back to the exact source file and range, including included `.typ`
  files.
- Keeps the editor preview separate from the PDF.js presenter/audience path, so
  speaker scripts remain private and failed edits never replace the last good
  audience PDF.
- Runs on Linux, macOS, and Windows through Tauri 2.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- [Rust](https://rustup.rs/) stable
- [Typst](https://github.com/typst/typst) available as `typst` on `PATH`
- Tauri's platform prerequisites for your operating system

Release installers include a pinned Tinymist binary, so installed applications
do not download anything at runtime. Creating a distributable source build
downloads and verifies the matching Tinymist v0.15.2 sidecar on first use; later builds reuse the
local file and GitHub Actions cache.

## Development

```sh
npm install
npm run tauri dev
```

Run all checks:

```sh
npm run check
```

Build an installer for the current operating system:

```sh
npm run tauri build
```

The editing workspace runs entirely on the local machine. Set `TINYMIST_PATH`
to test a different Tinymist executable; otherwise the bundled pinned version
is preferred, with `PATH` and common Homebrew/Cargo locations as fallbacks.

## Speaker notes

Touying notes work without changing the deck:

```typst
#slide[
  == Live editing
  The audience sees this.

  #speaker-note[
    Mention that the source can be edited during the talk.
  ]
]
```

Typst Presenter queries Touying's `<pdfpc-file>` metadata after each successful
build. Decks without this metadata still render normally with an empty notes
panel.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Previous slide | `ArrowLeft`, `ArrowUp`, `PageUp` |
| Next slide | `ArrowRight`, `ArrowDown`, `PageDown`, `Space` |
| First / last slide | `Home` / `End` |
| Toggle audience fullscreen | `F` |
| Reset timer | `R` |
| Save in editing mode | `Cmd/Ctrl-S` |
| Completion | `Ctrl-Space` |
| Signature help | `Cmd/Ctrl-Shift-Space` |
| Go to definition / references | `F12` / `Shift-F12` |
| Rename symbol | `F2` |
| Format document | `Shift-Alt-F` |

## License

MIT

# Typst Presenter

A cross-platform presenter console for Typst decks. Keep editing `.typ` files in
your favorite editor while the app rebuilds the PDF, refreshes both screens, and
shows Touying speaker notes in real time.

## MVP features

- Watches the whole deck directory for source and asset changes.
- Compiles revisioned PDFs with the local Typst CLI.
- Keeps the last good PDF visible when the current source has errors.
- Reads Touying `#speaker-note[...]` content from pdfpc metadata.
- Provides current/next previews, notes, timer, slide navigation, and keyboard
  controls in the presenter view.
- Opens a separate audience window and can hand the current PDF to the operating
  system's default viewer.
- Runs on Linux, macOS, and Windows through Tauri 2.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- [Rust](https://rustup.rs/) stable
- [Typst](https://github.com/typst/typst) available as `typst` on `PATH`
- Tauri's platform prerequisites for your operating system

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

## License

MIT

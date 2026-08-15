# Contributing

Thanks for improving Typst Presenter.

## Before opening a pull request

1. Open or reference a GitHub issue for user-visible behavior changes.
2. Keep each pull request focused on one vertical slice.
3. Add tests at the highest practical seam: navigation and UI state in
   TypeScript; compilation metadata and filesystem behavior in Rust.
4. Run `npm run check` on a machine with Tauri's platform prerequisites.
5. Verify `examples/demo.typ` manually when changing live reload, PDF rendering,
   notes, or multi-window behavior.

## Commit messages

Use a short imperative subject. Conventional Commit prefixes are welcome:
`feat:`, `fix:`, `docs:`, `test:`, `refactor:`, and `chore:`.

## Pull requests

Describe the user-visible outcome, testing performed, and any platform-specific
risk. Include screenshots or a short capture for UI changes.

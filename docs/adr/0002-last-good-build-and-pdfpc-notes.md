# ADR-0002: Keep the last good PDF and query pdfpc notes

- Status: accepted
- Date: 2026-08-15

## Context

Source files are often temporarily invalid while being edited. Replacing the
presentation with an error screen would make live editing unsafe. Parsing
`#speaker-note[...]` from source cannot correctly resolve includes, functions,
or Touying subslides.

## Decision

Each successful build produces an immutable, revisioned temporary PDF. A failed
build only updates diagnostics; all windows continue showing the last good PDF.
Speaker notes are read by evaluating `query(<pdfpc-file>).first().value`, the
metadata interface emitted by current Touying versions. The deprecated
`typst query` command remains a compatibility fallback for older Typst versions.

## Consequences

- A transient Typst error cannot blank the audience display.
- Notes follow Touying's own resolution of includes, pauses, and subslides.
- Plain Typst decks remain presentable with an empty notes panel.
- Temporary PDFs are revisioned so an external PDF viewer never blocks rebuilds
  on Windows.

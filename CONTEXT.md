# Typst Presenter domain

Typst Presenter is a cross-platform desktop companion for presenting slides that
are authored in Typst. It includes an optional Tinymist-powered editing workspace
for rehearsal and live corrections, while remaining compatible with external
editors.

## Glossary

- **deck**: the selected root `.typ` file and all files it depends on.
- **build**: one attempt to compile the deck to PDF and query its presentation
  metadata.
- **last good build**: the newest successful build. It remains visible if a later
  build fails.
- **slide**: one physical PDF page. Touying may create multiple slides for one
  logical slide through pauses.
- **speaker note**: presenter-only text attached to a physical slide. Touying
  exposes these through pdfpc metadata.
- **presenter view**: the control surface showing current/next slides, notes,
  timing, and build status.
- **audience view**: a separate window that only displays the current slide.
- **live reload**: rebuilding after a dependency in the deck directory changes,
  then atomically replacing the last good build.
- **editing workspace**: the optional source editor, Tinymist language service,
  Web/SVG preview, and speaker notes surface inside the presenter window.
- **source jump**: a source-mapped navigation from preview content to a file and
  UTF-16 source range in the editing workspace.

## Product boundaries

- Users may edit in the built-in editing workspace or keep using VS Code,
  Neovim, Zed, or another editor.
- Typst Presenter uses the locally installed `typst` CLI, including its package
  cache, fonts, and normal project semantics.
- The editing workspace uses one local Tinymist language-server session for the
  active deck. Tinymist is optional: its failure does not disable presenter or
  audience view.
- Tinymist Web/SVG output is editor-only. Presenter and audience views use the
  last good PDF, and the audience never receives speaker notes or editing UI.
- Touying is supported through its public pdfpc metadata contract. Plain Typst
  PDFs still work, but have no extracted notes unless they expose that metadata.
- No cloud account or network service is required while presenting.

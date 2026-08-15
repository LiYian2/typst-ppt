# Typst Presenter domain

Typst Presenter is a cross-platform desktop companion for presenting slides that
are authored in Typst. It does not replace the user's editor.

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

## Product boundaries

- Users keep editing with VS Code, Neovim, Zed, or another editor.
- Typst Presenter uses the locally installed `typst` CLI, including its package
  cache, fonts, and normal project semantics.
- Touying is supported through its public pdfpc metadata contract. Plain Typst
  PDFs still work, but have no extracted notes unless they expose that metadata.
- No cloud account or network service is required while presenting.

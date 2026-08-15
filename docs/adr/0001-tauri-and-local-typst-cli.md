# ADR-0001: Tauri shell with the local Typst CLI

- Status: accepted
- Date: 2026-08-15

## Context

The application must run on Linux, macOS, and Windows, watch projects edited by
external tools, compile Typst quickly, present in a second window, and open the
generated PDF in a native viewer.

## Decision

Use Tauri 2 for the desktop shell, React/TypeScript for shared UI, and Rust for
filesystem/process integration. Invoke the user's local `typst` executable for
both PDF compilation and metadata queries. Render the resulting PDF in the
webview with PDF.js.

## Consequences

- Platform-specific integration is small and concentrated in Rust/Tauri.
- The app stays compatible with the user's Typst packages, fonts, and CLI flags.
- Typst must be installed and available on `PATH`; the UI reports a clear error
  when it is missing.
- PDF.js gives identical slide rendering behavior in both application windows.

# Security policy

## Supported versions

Until the first stable release, security fixes are applied to the latest code on
`main`.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do not
open a public issue with an exploit or a malicious PDF. Include the affected
version, operating system, reproduction steps, and the smallest safe test case.

Typst Presenter executes the local `typst` program and opens user-selected deck
files. Reports involving command execution, path traversal, unsafe PDF handling,
or Tauri capability escalation are treated as high priority.

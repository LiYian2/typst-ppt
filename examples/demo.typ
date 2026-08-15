#import "@preview/touying:0.7.4": *
#import themes.metropolis: *

#show: metropolis-theme.with(
  aspect-ratio: "16-9",
  config-info(
    title: [Typst Presenter],
    subtitle: [Edit the source. Keep the stage alive.],
    author: [Live demo],
  ),
)

#title-slide()
#speaker-note[
  Welcome everyone. This note is visible only in the presenter window.
]

= One source, two screens

== Live reload

Edit this sentence while Typst Presenter is open.

#pause

#text(1.25em, weight: "bold", fill: rgb("8cbf26"))[The next step appears immediately.]

#speaker-note[
  Save this file now and point out that the audience keeps seeing the last good build.
]

== Last-good safety

#grid(
  columns: (1fr, 1fr),
  gutter: 1.2em,
  block(fill: rgb("edf7da"), inset: 1em, radius: 8pt)[
    *Successful build* \\
    Replaces both windows atomically.
  ],
  block(fill: rgb("ffe7e7"), inset: 1em, radius: 8pt)[
    *Broken source* \\
    Shows diagnostics, never a black screen.
  ],
)

#speaker-note[
  Deliberately introduce a syntax error if it is safe to demonstrate the fallback.
]

== Ready for the room

#align(center + horizon)[
  #text(2em, weight: "bold")[Open. Edit. Present.]
]

#speaker-note[
  Press F to fullscreen the audience window. Press R to reset the timer.
]

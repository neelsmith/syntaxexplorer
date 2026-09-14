# `apps/sentence-explorer/` — first app built on the library

A minimal single-page app that lets a user pick a local `arsgrammatica`
saved-analysis file and browse its sentences. It's meant both as a
usable tool and as a worked example of building an app on `js/lib/`.

## Opening it

Just open `apps/sentence-explorer/index.html` directly in a browser
(double-click it, or drag it into a browser window) — no server, no
build step. It loads `../../js/lib/cts-urn.js` and
`../../js/lib/arsgrammatica.js` via plain relative `<script src>` tags,
which works over `file://` (see notes/library-api.md for why this
matters and how it was verified).

If this app is ever moved or packaged on its own, take `index.html`,
`app.js`, and a copy of `js/lib/` with it, keeping the same relative
layout (`js/lib/` two levels up from the HTML file), or adjust the
`<script src>` paths in `index.html` to match wherever `js/lib/` ends
up.

## What it does

1. `<input type="file">` lets the user pick a local text file (no
   upload — `FileReader` reads it directly in the browser).
2. The file's text is handed to `ArsGrammatica.parseAnalysis`.
3. A menu (`<select>`) is built with one option per sentence, labelled
   by `ArsGrammatica.sentenceLabel` (passage component + preview of the
   first 4 tokens + `…` if the sentence is longer) — exactly the label
   format the project calls for.
4. Selecting a sentence computes its full token slice with
   `ArsGrammatica.tokensForSentence` and shows the full black-text view
   from `ArsGrammatica.sentenceText`.

`app.js` is intentionally just DOM wiring — reading the file, filling
in the menu, reacting to selection, and showing readable error messages
if a file doesn't have the expected blocks or a sentence's token
references don't resolve. All of the file-format knowledge and text
logic lives in `js/lib/`, not here, so another app can reuse the
library without pulling in any of this file.

## Known limitations (initial version)

- Only the `#!tokens` and `#!sentences` blocks are read; other blocks
  a file may contain (e.g. `#!verbal_units`, `#!lm`) are ignored.
- The black-text spacing heuristic in `sentenceText` is character-class
  based (see notes/library-api.md); unusual punctuation not in its
  opening/trailing sets will default to "space before", which may not
  always be right.
- No syntax/dependency visualization yet — this version only covers
  the tokens+sentences reading and the plain-text sentence view asked
  for initially.

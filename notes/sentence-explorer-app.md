# `apps/sentence-explorer/` — first app built on the library

A minimal single-page app that lets a user pick a local `arsgrammatica`
saved-analysis file, browse its sentences, and view each sentence's
dependency relations as a graph. It's meant both as a usable tool and
as a worked example of building an app on `js/lib/`.

## Opening it

Just open `apps/sentence-explorer/index.html` directly in a browser
(double-click it, or drag it into a browser window) — no server, no
build step. It loads `../../js/lib/cts-urn.js`, `../../js/lib/arsgrammatica.js`,
and `../../js/vendor/mermaid/mermaid.min.js` via plain relative
`<script src>` tags, which works over `file://` (see notes/library-api.md
for why this matters and how it was verified).

If this app is ever moved or packaged on its own, take `index.html`,
`app.js`, and copies of `js/lib/` and `js/vendor/mermaid/` with it,
keeping the same relative layout (both two levels up from the HTML
file), or adjust the `<script src>` paths in `index.html` to match
wherever those end up.

## What it does

1. `<input type="file">` lets the user pick a local text file (no
   upload — `FileReader` reads it directly in the browser).
2. The file's text is handed to `ArsGrammatica.parseAnalysis`.
3. A menu (`<select>`) is built with one option per sentence, labelled
   by `ArsGrammatica.sentenceLabel` (passage component + preview of the
   first 4 tokens + `…` if the sentence is longer) — exactly the label
   format the project calls for.
4. Selecting a sentence computes its full token slice with
   `ArsGrammatica.tokensForSentence`, shows its full black-text view —
   via `ArsGrammatica.sentenceHtml`, so each word is colored by the
   verbal unit (clause-like subtree) it belongs to, using the exact
   same clustering and palette as the dependency graph below, not
   `ArsGrammatica.sentenceText` directly (that still underlies it: the
   wording and spacing are identical, just wrapped in colored `<span>`s
   — see notes/library-api.md) — and renders its dependency graph.
5. Below that — in its own full-width row, not squeezed into a column
   next to the sentence menu — a "Dependency graph" section has an
   orientation picker (Bottom-to-top/BT, the default, Top-to-bottom/TB,
   Left-to-right/LR, Right-to-left/RL — options mirror
   `ArsGrammatica.validGraphOrientations`) and the rendered graph
   itself. Changing orientation re-renders the currently-selected
   sentence's graph without needing to reselect it. Punctuation tokens
   (periods, commas, etc.) are left out of the graph, since they're
   essentially never meaningful nodes in a dependency diagram — this is
   `sentenceMermaidGraph`'s own default (`excludeTokenTypes: ["punctuation"]`),
   not something `app.js` does itself; see notes/library-api.md.
6. Nodes belonging to the same "verbal unit" (clause-like subtree —
   see notes/library-api.md's "Coloring by verbal unit" section) are
   colored with the same pastel color, again `sentenceMermaidGraph`'s
   own default (`colorByVerbalUnit: true`) rather than app-specific
   logic. If a sentence has more distinct verbal units than the
   8-color palette (rare), `sentenceMermaidGraph` returns a warning
   alongside the diagram; `app.js` logs it to the console and also
   shows it in the status line so it isn't silently missed.
7. The graph is rendered at its true natural size (not shrunk to fit)
   inside a fixed-height, pannable/zoomable viewport: scroll or pinch
   to zoom, drag to pan, or use the on-diagram +/-/reset buttons. This
   is what keeps a large sentence's graph legible instead of being
   squeezed down to card width — see the next section.

`app.js` is intentionally just DOM wiring — reading the file, filling
in the menu, reacting to selection and to orientation changes, calling
Mermaid to turn `ArsGrammatica.sentenceMermaidGraph`'s text output into
an SVG, and showing readable error messages if a file doesn't have the
expected blocks or a sentence's token references don't resolve. All of
the file-format knowledge, text logic, and graph-building logic live in
`js/lib/`, not here, so another app can reuse the library — including
generating the same Mermaid diagrams — without pulling in this file or
even Mermaid itself (`sentenceMermaidGraph` just returns text).

### Rendering: vendored Mermaid, not a CDN

`js/vendor/mermaid/mermaid.min.js` is a vendored copy of Mermaid's own
UMD build (`dist/mermaid.min.js` from the `mermaid` npm package;
`js/vendor/mermaid/LICENSE` is its MIT license). It's loaded the same
way as `js/lib/*.js` — a plain `<script src>` that sets a single
global, `mermaid` — so the diagram renders with no network access and
no build step, consistent with the rest of this app. The alternative
(pointing `<script src>` at a CDN URL) would also work over `file://`
in practice, but would make the app stop working offline; vendoring
keeps "just open the HTML file" true unconditionally. The tradeoff is
repo size: the vendored file is a few megabytes, since it bundles every
diagram type Mermaid supports, not just `graph`. To update the vendored
version later: `npm pack mermaid@<version>`, extract `package/dist/mermaid.min.js`
and `package/LICENSE`, and replace the two files in `js/vendor/mermaid/`.

`app.js` calls `mermaid.initialize({startOnLoad: false, flowchart: {useMaxWidth: false}})`
once (`startOnLoad: false` because Mermaid shouldn't auto-scan the page
for `.mermaid` elements; `useMaxWidth: false` because otherwise Mermaid
bakes a "shrink to container width" style into every diagram, which is
exactly what makes a big graph illegible) and then
`mermaid.render(id, definition)` each time a sentence is selected or
the orientation changes, inserting the returned SVG into `#graph-view`
directly — rather than using `mermaid.run()` against a static
`<pre class="mermaid">` block — because the diagram text changes on
every interaction and each render needs a fresh, uniquely-id'd call. A
render token (an incrementing counter compared before applying a
result) discards a render that's still in flight when the user has
already moved on to a different sentence or orientation, so a slow
render can't clobber a newer one.

### Panning and zooming: vendored svg-pan-zoom

`js/vendor/svg-pan-zoom/svg-pan-zoom.min.js` is a vendored copy of
[svg-pan-zoom](https://github.com/bumbu/svg-pan-zoom)'s UMD build
(`dist/svg-pan-zoom.min.js` from the `svg-pan-zoom` npm package;
`js/vendor/svg-pan-zoom/LICENSE` is its MIT license) — a small
(~30KB, vs. Mermaid's few megabytes), dependency-free library that
wraps an existing `<svg>` element with mouse-wheel zoom, drag-to-pan,
and (with `controlIconsEnabled: true`, as used here) on-diagram
zoom-in/zoom-out/reset buttons drawn directly into the SVG. Loaded the
same way as everything else here — a plain `<script src>` setting a
single global, `svgPanZoom` — for the same file:// / offline reasons as
Mermaid (see above).

`app.js`'s `attachPanZoom()` calls `svgPanZoom(svgEl, {zoomEnabled: true,
controlIconsEnabled: true, fit: true, center: true, minZoom: 0.2, maxZoom: 25})`
on the `<svg>` Mermaid just rendered, immediately after inserting it
into `#graph-view` — `fit`/`center` make the initial view show the
whole diagram, however large, scaled to fit the viewport, with zooming
in from there under the user's control. Each render destroys the
previous `svgPanZoom` instance (`panZoomInstance.destroy()`) before
creating a new one — a stale instance left attached to a DOM node
that's about to be replaced would otherwise leak listeners, and it
would go on trying to control a `<svg>` that no longer has the
diagram the user is currently looking at.

This is also why `#graph-view` is a fixed-height (`60vh`), overflow-hidden
box in `index.html`'s CSS rather than the natural-flow, scrollable box
from the first version of this app: svg-pan-zoom manages the visible
region itself via an SVG transform, so it needs a stable-size viewport
to fit and center against, and native scrollbars over the same content
would just fight it (double controls doing the same job).

### Layout: graph section is a full-width row, not a column

`#explorer` is a two-column CSS grid (sentence menu | sentence text).
`.graph-section` is given `grid-column: 1 / -1`, which — combined with
being placed after both column `<div>`s in the markup rather than
inside the second one — makes the grid auto-place it into a new row
that spans both columns, instead of sharing the second column with the
sentence-text view. "Full width" here means the full width of this
app's own content column (the same width as the header and file picker
above it, capped by `body`'s `max-width: 1100px`), not a break out to
the raw browser viewport width; the latter (a "full-bleed" section
wider than the rest of the centered page) is a reasonable follow-up if
the content-column width still isn't enough room, but wasn't what was
built here since it's a bigger visual change to the rest of the page,
worth deciding on deliberately rather than as a side effect of a graph
sizing fix.

## Known limitations (initial version)

- Only the `#!tokens` and `#!sentences` blocks are read; other blocks
  a file may contain (e.g. `#!verbal_units`, `#!lm`) are ignored.
- The black-text spacing heuristic in `sentenceText` is character-class
  based (see notes/library-api.md); unusual punctuation not in its
  opening/trailing sets will default to "space before", which may not
  always be right.
- The dependency graph only draws what `related1`/`related2` state
  directly; if a sentence's tokens span more than one CTS context, a
  token can only name a relation to another token in its *own* context
  (bare ids aren't unique across contexts), so the graph for such a
  sentence can come out as more than one disconnected piece. See
  notes/library-api.md and the second sentence in
  `test/sample-analysis.cex` for a worked example.

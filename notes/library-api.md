# `js/lib/` — reusable library API

This directory holds the reusable JavaScript library for reading and
working with syntactic analyses saved by `arsgrammatica`. It is written
so it can be dropped into other web apps unchanged, including apps
meant to run by opening a single HTML file directly from disk (a
`file://` URL, no web server).

## Why plain scripts, not ES modules

Browsers refuse to `fetch()` local module files over `file://` (a CORS
restriction), so `<script type="module">` breaks the moment a page is
opened straight from disk instead of through a server. Plain classic
scripts (`<script src="...">`) don't have that restriction — they load
fine over `file://`. So every file here:

- attaches its exports to a single global (`CtsUrn`, `ArsGrammatica`) —
  no `import`/`export`;
- also exports via `module.exports` when `module` exists, so the same
  files load unchanged under Node with `require(...)` (used by
  `test/run.js`).

An app built on top of this library just needs plain `<script src>`
tags for `js/lib/cts-urn.js` and `js/lib/arsgrammatica.js`, in that
order, before its own script. This was verified with an automated
end-to-end test that opens `apps/sentence-explorer/index.html` as a
literal `file://` URL in a real browser (headless Chromium) and drives
it exactly as a user would.

## `js/lib/cts-urn.js` — global `CtsUrn`

Generic CTS URN helpers, with no knowledge of arsgrammatica. A CTS URN
has exactly five colon-delimited components, e.g.

```
urn:cts:latinLit:phi0690.phi003.omar:1.1
1     2    3            4            5
```

- `CtsUrn.components(urn)` — the raw array from splitting on `:`.
- `CtsUrn.parse(urn)` — `{full, urnLabel, ctsLabel, namespace, work, passage}`;
  throws if there aren't exactly 5 components.
- `CtsUrn.workComponent(urn)` — the 4th component (e.g. `phi0690.phi003.omar`).
- `CtsUrn.passageComponent(urn)` — the 5th/last component (e.g. `1.1`).

## `js/lib/arsgrammatica.js` — global `ArsGrammatica`

### Parsing a saved analysis file

`arsgrammatica`'s saved-analysis format
(https://neelsmith.github.io/arsgrammatica/reference/analysisformat.html)
is a plain-text file of named blocks. Each block starts with a line
`#!blockname`, followed by a pipe-delimited header row and pipe-delimited
data rows. Blank lines and `//` comment lines are ignored anywhere.

- `ArsGrammatica.splitBlocks(text)` — low-level: returns
  `{blockName: [rawLine, ...]}` for every `#!`-introduced block found,
  whatever its internal shape (not every block in the format is a
  simple table — e.g. `#!lm` blocks are `KEY=VALUE` lines, not a pipe
  table — so this step doesn't assume a table shape).
- `ArsGrammatica.parseDelimitedBlock(lines, delimiter='|')` — turns one
  block's lines into `{header: [...], rows: [{col: value, ...}, ...]}`.
- `ArsGrammatica.parseAnalysis(text, {delimiter})` — the function apps
  should normally call. Applies `parseDelimitedBlock` specifically to
  the `#!tokens` and `#!sentences` blocks (the only two this initial
  version needs) and returns:
  ```
  {
    tokens: [{context, id, tokentype, text, lemma, ...}, ...],
    sentences: [{context_begin, first_token, context_end, last_token}, ...],
    tokensHeader: [...],       // column names actually present
    sentencesHeader: [...],
    blockNames: [...]          // every #!block name found, for diagnostics
  }
  ```
  Because rows are built from whatever header columns are actually in
  the file, this keeps working if `arsgrammatica` adds/reorders token
  columns later.

### Extracting a sentence's tokens

Each token is uniquely identified within the file by its
`(context, id)` pair; each sentence record names the `(context, id)`
pairs of its first and last token. Since the full token list is
ordered, a sentence's tokens are the *inclusive slice* between those
two positions — including cases where a sentence's tokens span more
than one `context` (e.g. a sentence that runs across a line break in
the source text; see the two-context sentence in
`test/sample-analysis.cex`).

- `ArsGrammatica.indexTokens(tokens)` — builds a `Map` from
  `"context␟id"` to array index, so repeated lookups don't each
  need a linear scan. Build once per file, reuse across all sentences.
- `ArsGrammatica.tokensForSentence(tokens, sentence, tokenIndex?)` —
  returns the inclusive slice of `tokens` for one sentence. `tokenIndex`
  is optional (one is built on the fly if omitted) but should be passed
  when processing many sentences from the same file. Throws a
  descriptive error if either endpoint can't be found, or if they're
  out of order.

### Rendering text

- `ArsGrammatica.sentenceText(tokenSlice, {noSpaceBefore?})` — the
  "black text" (plain surface text) of a run of tokens: each token's
  `text` field concatenated with whitespace inserted between tokens,
  *except* where that would be wrong. The default rule
  (`ArsGrammatica.defaultNoSpaceBefore`) suppresses the space before a
  token when:
  - it's the first token in the slice (never a leading space);
  - its `tokentype` is `enclitic` (e.g. `virum` + `que` → `virumque`);
  - its `tokentype` is `punctuation` and its text is a "trailing" mark
    (`. , ; : ! ? ) ] }` and closing quotes);
  - the *previous* token is `punctuation` and an "opening" mark
    (`( [ {` and opening quotes) — so nothing sticks right after it.

  This is a heuristic based on `tokentype` and the token's own
  character(s), not a full model of Latin/Greek orthography (it doesn't
  know about elision, apostrophes standing in for omitted letters, etc.
  beyond what the opening/trailing-punctuation character classes catch).
  Pass a different `noSpaceBefore(token, previousToken)` function via
  options to override it for a particular corpus or language.

- `ArsGrammatica.sentenceLabel(tokenSlice, {maxTokens=4, separator=': ', ellipsis='…'})` —
  a short menu label: the passage component of the *first* token's CTS
  URN (via `CtsUrn.passageComponent`, with a same-behavior fallback if
  `cts-urn.js` isn't loaded), a separator, the `sentenceText` of the
  first `maxTokens` tokens, and a trailing ellipsis whenever the
  sentence has *more* than `maxTokens` tokens in total.

  Note this last count is literal: if the only token past the preview
  window is closing punctuation (e.g. a 5-token sentence that's 4 words
  plus a final period), the ellipsis still appears, because the rule is
  "more than 4 tokens", not "more meaningful text remains". This is by
  design, matching the stated menu-label rule exactly — see
  `test/run.js` for a test that pins down this exact behavior. If a
  future version should special-case trailing punctuation, that's a
  deliberate change to make there, not an oversight here.

### Rendering a sentence's dependency relations as a graph

- `ArsGrammatica.sentenceMermaidGraph(tokenSlice, {orientation='BT', excludeTokenTypes=['punctuation']})` —
  builds a complete [Mermaid](https://mermaid.js.org/) `graph` definition
  (a flowchart-family diagram) from a sentence's tokens, using the
  `related1`/`relationship1` and `related2`/`relationship2` columns:
  - Every token whose `tokentype` (case-insensitive) is not in
    `excludeTokenTypes` becomes a node, labelled with its `text`.
    `excludeTokenTypes` defaults to `["punctuation"]`, since punctuation
    tokens are essentially never meaningful nodes in a dependency graph
    and rarely carry relations of their own; pass `excludeTokenTypes: []`
    to include every token, punctuation included. The default list is
    also exposed as `ArsGrammatica.defaultExcludedTokenTypes`, the same
    pattern as `validGraphOrientations` below.
  - `relatedN` names another token's `id`; an edge is drawn from the
    token to that target, labelled with `relationshipN` — but only when
    the target is itself an *included* token: a `relatedN` value naming
    an excluded (e.g. punctuation) token is treated the same as an
    unresolvable one (see below) rather than being drawn anyway.
  - Because a token's `id` is only guaranteed unique *within its own
    `context`* (see the format's own rules, above), a `relatedN` value
    is resolved by pairing it with the *token's own* `context` — not
    the sentence's overall context — before looking it up. One
    consequence, seen in `test/sample-analysis.cex`'s second sentence:
    when a sentence spans two contexts, a token in the second context
    cannot name a relation to a token in the first (there's no way to
    express that with a bare id), so such a sentence's graph can end up
    with more than one disconnected component. That's a limitation of
    the file format itself, not something this function works around.
  - A `relatedN` value that doesn't resolve to any included token in the
    slice at all (for example, the `"root"` sentinel arsgrammatica's own
    documentation shows being used in a token's own `related1` field to
    flag it as the sentence's syntactic root, rather than pointing at
    another token) is simply skipped — no edge and no fabricated `root`
    node are created for it. If excluding a token type leaves nothing at
    all (e.g. a punctuation-only "sentence"), the function throws rather
    than silently returning an empty diagram.
  - `orientation` must be one of `"TB"`, `"BT"` (the default — root/verb
    typically ends up near the bottom), `"LR"`, `"RL"` — the full list is
    also exposed as `ArsGrammatica.validGraphOrientations`, so an app can
    build a picker from it instead of hardcoding the list.
  - Node and edge label text is escaped (quotes, backslashes, and, in
    edge labels, the `|` delimiter itself) so a stray character in the
    source data can't corrupt the diagram syntax.

  This function only ever returns Mermaid *source text* — it doesn't
  render anything itself, so it has no dependency on Mermaid (or any
  other library) and is just as reusable in a context that never wants
  to draw a picture (e.g. exporting the definition to paste into a
  Markdown file elsewhere). `apps/sentence-explorer` is what actually
  renders it, using a vendored copy of Mermaid — see
  notes/sentence-explorer-app.md.

## Testing

`test/run.js` is a small, dependency-free Node test file (uses only
`assert` from the standard library) that exercises every function above
against `test/sample-analysis.cex`, a synthetic two-sentence analysis
(the opening of the Aeneid) built directly from the documented format,
including a sentence that spans two `context` URNs. Run it with:

```
node test/run.js
```

The library's actual in-browser behavior — including that plain
`<script src>` loading really does work over a `file://` URL — was
additionally verified with a one-off Playwright script that opened
`apps/sentence-explorer/index.html` as a `file://` URL in headless
Chromium and drove the file input, sentence menu, and text view exactly
as a person would. That script was scratch work for this session and
wasn't checked in; `test/run.js` is the durable, repeatable test.

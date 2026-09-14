# Plan: API documentation for `js/lib/`

A recommendation to revisit before actually implementing anything —
nothing here has been acted on yet. See `notes/library-api.md` and
`notes/sentence-explorer-app.md` for the current documentation, which
this plan builds on rather than replaces.

## Two layers, not one

Treat "API docs" as two different jobs, aimed at two different
questions, kept in two different places:

- **Reference** — "what are this function's parameters and return
  value?" Mechanical, exhaustive, and needs to stay in lockstep with
  the code. This should live in the JSDoc comments in `js/lib/*.js`
  themselves, not be restated by hand elsewhere.
- **Guide / explanation** — "why does this work this way, and how do I
  use it for X?" This is what `notes/library-api.md` and
  `notes/sentence-explorer-app.md` already do well: the CEX format,
  why plain scripts instead of ES modules, the verbal-unit algorithm's
  two wrinkles and why they exist, the color-consistency contract
  between the graph and text views.

The split matters because these notes have already had to be
hand-corrected more than once this session as the API's shape changed
(`sentenceMermaidGraph`'s return type, then `sentenceHtml`'s
span-wrapping behavior) — exactly the kind of drift that happens when
prose restates full signatures instead of just linking to them. Going
forward, prose docs should describe behavior and rationale and point
at the JSDoc for exact signatures, not restate the signatures
themselves.

## Current state (as of this session)

- Every exported function in `js/lib/cts-urn.js` and
  `js/lib/syntaxer.js` already has a JSDoc block with
  `@param`/`@returns`. This is the right foundation and should stay
  the source of truth for exact signatures.
- `notes/library-api.md` is a hand-written narrative reference/guide
  hybrid, organized by topic (parsing, text rendering, the graph,
  verbal-unit coloring, hover). It's thorough but requires manual
  upkeep whenever a function's contract changes.
- No documentation-generation tooling exists yet, and the repo has no
  `package.json` / npm dependencies at all — consistent with the
  project's "just open the HTML file" design.

## Recommendations

1. **Keep JSDoc as the source of truth for reference material.** Don't
   let `notes/library-api.md` restate full parameter/return
   signatures; have it describe behavior and link to the function by
   name, trusting the JSDoc for exact mechanics.

2. **Add `@example` blocks to exported functions.** Most current JSDoc
   comments describe behavior in prose but don't show a runnable
   snippet. Concrete examples pay off immediately for anyone reading
   the source, and pay off again for free if a generator is added
   later (see below).

3. **Mark what's public vs. internal.** Everything on the
   `Syntaxer`/`CtsUrn` export objects is the contract; helpers
   like `computeVerbalUnitColoring`, `escapeHtml`, or
   `cssEscapeAttrValue` are not. A `@private` tag (or at minimum a
   one-line comment marking the "internal helpers" section) keeps that
   boundary legible to readers and to any future tooling.

4. **Document the environment/compatibility contract as its own
   section**, not left implicit: script load order
   (`cts-urn.js` before `syntaxer.js`), the dual
   browser-global/`module.exports` pattern, and the `file://`
   compatibility guarantee. `notes/library-api.md` already covers most
   of this near the top; keep it a required section as the library
   grows, not something folded into a random subsection.

5. **Hold off on a documentation-generator tool for now.** The library
   is still two files with a modest surface, and the repo has been
   deliberately dependency-free. A generator's payoff (a browsable,
   always-in-sync HTML/Markdown reference) is real, but only clearly
   worth the tradeoff (first npm dependency, a build step to run even
   if it's dev-only) once one of the "revisit" triggers below applies.
   Until then, rigorous JSDoc + a well-organized hand-written guide
   covers the actual need.

## When to revisit the "no generator" decision

Reasonable triggers to reconsider adding tooling:

- The library grows past a handful of files, or the exported surface
  grows large enough that manually keeping `notes/library-api.md`'s
  organization scannable becomes real effort.
- Someone other than you needs to browse the API without reading
  source (a collaborator, or users of `js/lib/` in a different app).
- The library gets published or distributed on its own (e.g. as its
  own repo or package), where a hosted reference page is the norm.

## If/when a generator is added

Two reasonable choices, both dev-only (neither touches the shipped
`<script src>` files or the `file://` story at all):

- **`documentation.js`** — understands plain JSDoc without requiring
  TypeScript; can emit Markdown or static HTML; is git-aware about
  what's actually exported. Probably the better fit here.
- **`jsdoc`** (the original tool) plus a modern theme (e.g. `docdash`
  or `clean-jsdoc-theme`) — more mature, more configuration needed.

Practical notes for whichever is chosen:

- Run it as a `devDependency` with an npm script (e.g.
  `npm run docs:build`), never as part of loading the app itself.
- Don't commit generated output into the repo (avoids diff noise and
  merge pain); either generate on demand locally, or publish it
  separately (e.g. GitHub Pages from a workflow) if a hosted copy is
  wanted.
- Once `eslint` is in the picture for any reason, turn on
  `eslint-plugin-jsdoc` — it catches missing `@param`/`@returns` and
  name mismatches between a doc comment and the actual signature,
  which is cheap insurance against the kind of drift called out above.

# Quickstart: building your own app on `js/lib/`

The short version, for someone who wants a different app on the same
library rather than the full reference. For exact signatures and
rationale, see `notes/library-api.md`; for a complete working example
to copy from, see `apps/sentence-explorer/`.

## 1. Copy the files you need

- Always: `js/lib/cts-urn.js`, `js/lib/syntaxer.js`
- Only if you want the dependency graph: `js/vendor/mermaid/mermaid.min.js`,
  `js/vendor/svg-pan-zoom/svg-pan-zoom.min.js`

## 2. Load them as plain `<script>` tags, in this order

```html
<script src="js/lib/cts-urn.js"></script>
<script src="js/lib/syntaxer.js"></script>
<script src="js/vendor/mermaid/mermaid.min.js"></script>        <!-- optional -->
<script src="js/vendor/svg-pan-zoom/svg-pan-zoom.min.js"></script> <!-- optional -->
<script src="app.js"></script>
```

Never `type="module"` — that's what lets the page open straight from
disk (`file://`), no server required.

## 3. The core workflow

```js
// Parse a saved analysis file's text (e.g. from FileReader).
var parsed = Syntaxer.parseAnalysis(fileText);
var tokenIndex = Syntaxer.indexTokens(parsed.tokens);

// Build a sentence menu.
var label = Syntaxer.sentenceLabel(
  Syntaxer.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex)
); // "1.1: Arma virumque cano …"

// Get one sentence's tokens.
var slice = Syntaxer.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);

// Render its text -- colored by verbal unit, hover-ready.
var textResult = Syntaxer.sentenceHtml(slice);
textContainer.innerHTML = textResult.html;
Syntaxer.enableTokenHover(textContainer); // call once, ever -- survives re-renders

// Render its dependency graph (needs mermaid.js, loaded above).
var graphResult = Syntaxer.sentenceMermaidGraph(slice, { orientation: 'BT' });
mermaid.render('some-unique-id', graphResult.diagram).then(function (result) {
  graphContainer.innerHTML = result.svg;
  svgPanZoom(graphContainer.querySelector('svg'), {
    zoomEnabled: true, controlIconsEnabled: true, fit: true, center: true
  });
});
```

That's the whole surface most apps need. Both render calls also return
a `warnings` array (non-fatal issues, e.g. more verbal units than the
palette has colors) worth logging or surfacing somewhere.

## Notes for a different kind of app

- Don't need coloring or hover at all? Use `Syntaxer.sentenceText(slice)`
  for plain text instead of `sentenceHtml`.
- Don't need the graph? Skip the Mermaid/svg-pan-zoom scripts entirely
  — `sentenceMermaidGraph` is the only function that needs them, and
  only when you actually render its output.
- Multiple sentences on screen at once? Each needs its own container
  passed to `enableTokenHover` (it looks for related tokens only
  within the container it's called on).

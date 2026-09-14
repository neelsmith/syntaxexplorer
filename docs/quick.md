# Quick start to building your own syntax explorer app


## 1. Files you need

- Always: `js/lib/cts-urn.js`, `js/lib/syntaxer.js`
- Only needed if you want graph visualization: `js/vendor/mermaid/mermaid.min.js`,
  `js/vendor/svg-pan-zoom/svg-pan-zoom.min.js`

## 2. Loading them in your HTML


Load them as plain `<script>` tags, in this order

```html
<script src="js/lib/cts-urn.js"></script>
<script src="js/lib/syntaxer.js"></script>
<script src="js/vendor/mermaid/mermaid.min.js"></script>        <!-- optional -->
<script src="js/vendor/svg-pan-zoom/svg-pan-zoom.min.js"></script> <!-- optional -->
<script src="app.js"></script>
```


## 3. The core workflow

```js
// Parse the text of a saved analysis file  (e.g. from FileReader).
var parsed = Syntaxer.parseAnalysis(fileText);
var tokenIndex = Syntaxer.indexTokens(parsed.tokens);

// Build a sentence menu.
var label = Syntaxer.sentenceLabel(
  Syntaxer.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex)
); // e.g.  "1.1: Arma virumque cano …"

// Get one sentence's tokens.
var slice = Syntaxer.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);

// Render its text -- colored by verbal unit, hover-ready.
var textResult = Syntaxer.sentenceHtml(slice);
textContainer.innerHTML = textResult.html;
Syntaxer.enableTokenHover(textContainer); // call once, ever -- survives re-renders

// Render its dependency graph with Mermaid (needs mermaid.js, loaded above).
var graphResult = Syntaxer.sentenceMermaidGraph(slice, { orientation: 'BT' });
mermaid.render('some-unique-id', graphResult.diagram).then(function (result) {
  graphContainer.innerHTML = result.svg;
  svgPanZoom(graphContainer.querySelector('svg'), {
    zoomEnabled: true, controlIconsEnabled: true, fit: true, center: true
  });
});
```

Both render calls also return a `warnings` array (non-fatal issues, e.g. more verbal units than the palette has colors) worth logging or surfacing somewhere.



## Other options

To place multiple sentences on your page at the same time, put each in its own container  passed to `enableTokenHover`. (It looks for related tokens only within the container it's called on).

If you don't need coloring or hover at all, use `Syntaxer.sentenceText(slice)` for plain text instead of `sentenceHtml`.



/**
 * Plain-Node smoke tests for js/lib/cts-urn.js and js/lib/arsgrammatica.js.
 * No test framework or npm dependencies required: run with
 *
 *   node test/run.js
 *
 * from the repository root.
 */
'use strict';

var assert = require('assert');
var fs = require('fs');
var path = require('path');

var CtsUrn = require('../js/lib/cts-urn.js');
var ArsGrammatica = require('../js/lib/arsgrammatica.js');

var passed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('ok - ' + name);
  } catch (err) {
    console.error('FAIL - ' + name);
    console.error(err);
    process.exitCode = 1;
  }
}

// -- CtsUrn -----------------------------------------------------------

check('CtsUrn.workComponent extracts the 4th component', function () {
  var urn = 'urn:cts:latinLit:phi0690.phi003.omar:1.1';
  assert.strictEqual(CtsUrn.workComponent(urn), 'phi0690.phi003.omar');
});

check('CtsUrn.passageComponent extracts the last component', function () {
  var urn = 'urn:cts:latinLit:phi0690.phi003.omar:1.1';
  assert.strictEqual(CtsUrn.passageComponent(urn), '1.1');
});

check('CtsUrn.parse rejects a URN without 5 components', function () {
  assert.throws(function () {
    CtsUrn.parse('urn:cts:latinLit:phi0690.phi003.omar');
  }, /5 colon-delimited components/);
});

// -- ArsGrammatica.parseAnalysis ---------------------------------------

var sampleText = fs.readFileSync(path.join(__dirname, 'sample-analysis.cex'), 'utf8');
var parsed = ArsGrammatica.parseAnalysis(sampleText);

check('parseAnalysis finds both blocks', function () {
  assert.ok(parsed.blockNames.indexOf('tokens') !== -1);
  assert.ok(parsed.blockNames.indexOf('sentences') !== -1);
});

check('parseAnalysis reads all tokens', function () {
  assert.strictEqual(parsed.tokens.length, 12);
  assert.strictEqual(parsed.tokens[0].text, 'Arma');
  assert.strictEqual(parsed.tokens[0].context, 'urn:cts:latinLit:phi0690.phi003.omar:1.1');
  assert.strictEqual(parsed.tokens[0].id, 't0');
});

check('parseAnalysis reads all sentences', function () {
  assert.strictEqual(parsed.sentences.length, 2);
  assert.strictEqual(parsed.sentences[0].first_token, 't0');
  assert.strictEqual(parsed.sentences[0].last_token, 't4');
});

check('parseAnalysis ignores comment and blank lines', function () {
  // the sample file's leading "//" lines and blank lines should not
  // leak into either block's rows
  assert.ok(parsed.tokens.every(function (t) { return t.context.indexOf('//') === -1; }));
});

// -- tokensForSentence ---------------------------------------------------

var tokenIndex = ArsGrammatica.indexTokens(parsed.tokens);

check('tokensForSentence extracts the right inclusive slice (single context)', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  assert.strictEqual(slice.length, 5);
  assert.strictEqual(slice[0].text, 'Arma');
  assert.strictEqual(slice[slice.length - 1].text, '.');
});

check('tokensForSentence handles a sentence spanning two contexts', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[1], tokenIndex);
  assert.strictEqual(slice.length, 7);
  assert.strictEqual(slice[0].text, 'Troiae');
  assert.strictEqual(slice[slice.length - 1].text, '.');
});

check('tokensForSentence works without a prebuilt index too', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0]);
  assert.strictEqual(slice.length, 5);
});

check('tokensForSentence throws a clear error for an unmatched token', function () {
  assert.throws(function () {
    ArsGrammatica.tokensForSentence(parsed.tokens, { context_begin: 'nope', first_token: 'x', context_end: 'nope', last_token: 'y' }, tokenIndex);
  }, /could not find first token/);
});

// -- sentenceText (black-text view) --------------------------------------

check('sentenceText joins words with spaces, attaches enclitics, and suppresses space before trailing punctuation', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var text = ArsGrammatica.sentenceText(slice);
  assert.strictEqual(text, 'Arma virumque cano.');
});

check('sentenceText handles a longer, multi-context sentence', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[1], tokenIndex);
  var text = ArsGrammatica.sentenceText(slice);
  assert.strictEqual(text, 'Troiae qui primus ab oris Italiam.');
});

// -- sentenceLabel (menu label) ------------------------------------------

check('sentenceLabel shows passage + first 4 tokens + ellipsis when truncated', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[1], tokenIndex);
  var label = ArsGrammatica.sentenceLabel(slice);
  assert.strictEqual(label, '1.2: Troiae qui primus ab …');
});

check('sentenceLabel shows an ellipsis whenever token count exceeds maxTokens, even if only trailing punctuation remains', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var label = ArsGrammatica.sentenceLabel(slice);
  assert.strictEqual(label, '1.1: Arma virumque cano \u2026');
});

// -- sentenceMermaidGraph (dependency graph) ------------------------------

check('sentenceMermaidGraph defaults to BT orientation', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  assert.ok(graph.indexOf('graph BT\n') === 0, 'expected graph to start with "graph BT", got: ' + JSON.stringify(graph.slice(0, 20)));
});

check('ArsGrammatica.defaultExcludedTokenTypes exposes the default exclusion list', function () {
  assert.deepStrictEqual(ArsGrammatica.defaultExcludedTokenTypes, ['punctuation']);
});

check('sentenceMermaidGraph accepts TB/LR/RL orientation', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  ['TB', 'LR', 'RL'].forEach(function (orientation) {
    var graph = ArsGrammatica.sentenceMermaidGraph(slice, { orientation: orientation }).diagram;
    assert.ok(graph.indexOf('graph ' + orientation + '\n') === 0);
  });
});

check('sentenceMermaidGraph rejects an invalid orientation', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  assert.throws(function () {
    ArsGrammatica.sentenceMermaidGraph(slice, { orientation: 'DIAGONAL' });
  }, /invalid orientation/);
});

check('sentenceMermaidGraph rejects an empty token slice', function () {
  assert.throws(function () {
    ArsGrammatica.sentenceMermaidGraph([]);
  }, /token slice is empty/);
});

check('sentenceMermaidGraph declares one node per non-punctuation token, labelled with its text', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  ['Arma', 'virum', 'que', 'cano'].forEach(function (text, i) {
    assert.ok(graph.indexOf('n' + i + '["' + text + '"]') !== -1, 'missing node for "' + text + '" in:\n' + graph);
  });
});

check('sentenceMermaidGraph excludes punctuation tokens by default', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  assert.strictEqual(graph.indexOf('["."]'), -1, 'a node for the period should not be present by default:\n' + graph);
  var nodeCount = (graph.match(/^  n\d+\[/gm) || []).length;
  assert.strictEqual(nodeCount, 4, 'expected 4 nodes (punctuation excluded), got ' + nodeCount + ':\n' + graph);
});

check('sentenceMermaidGraph can include punctuation via excludeTokenTypes: []', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice, { excludeTokenTypes: [] }).diagram;
  assert.ok(graph.indexOf('["."]') !== -1, 'expected a node for the period when excludeTokenTypes is empty:\n' + graph);
  var nodeCount = (graph.match(/^  n\d+\[/gm) || []).length;
  assert.strictEqual(nodeCount, 5, 'expected 5 nodes (nothing excluded), got ' + nodeCount + ':\n' + graph);
});

check('sentenceMermaidGraph drops an edge whose relatedN points at an excluded (punctuation) token', function () {
  var slice = [
    { context: 'urn:cts:test:work:1', id: 't0', tokentype: 'lexical', text: 'foo', related1: 't1', relationship1: 'points at punctuation' },
    { context: 'urn:cts:test:work:1', id: 't1', tokentype: 'punctuation', text: '.' }
  ];
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  assert.strictEqual((graph.match(/^  n\d+\[/gm) || []).length, 1, 'expected only the non-punctuation token as a node:\n' + graph);
  assert.strictEqual(graph.indexOf('-->'), -1, 'expected no edge, since its only target was excluded:\n' + graph);
});

check('sentenceMermaidGraph throws if excludeTokenTypes removes every token', function () {
  var slice = [
    { context: 'urn:cts:test:work:1', id: 't0', tokentype: 'punctuation', text: '.' }
  ];
  assert.throws(function () {
    ArsGrammatica.sentenceMermaidGraph(slice);
  }, /no tokens remain after excluding tokentypes/);
});

check('sentenceMermaidGraph draws edges for related1/relationship1 and related2/relationship2', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  // arma (n0) and virum (n1) are both direct objects of cano (n3)
  assert.ok(graph.indexOf('n0 -->|direct object| n3') !== -1, graph);
  assert.ok(graph.indexOf('n1 -->|direct object| n3') !== -1, graph);
  // que (n2) coordinates both arma (n0) and virum (n1) via its two related/relationship pairs
  assert.ok(graph.indexOf('n2 -->|coordinating conjunction| n0') !== -1, graph);
  assert.ok(graph.indexOf('n2 -->|coordinating conjunction| n1') !== -1, graph);
});

check('sentenceMermaidGraph skips a related1 value that does not resolve to a token in the sentence (e.g. the "root" sentinel)', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  // cano (n3, related1="root") must not produce an edge to a fabricated "root" node
  assert.strictEqual(graph.indexOf('-->|unit verb|'), -1, 'should not have turned the "root" sentinel into an edge:\n' + graph);
  assert.strictEqual(graph.indexOf('"root"'), -1, 'should not have turned the "root" sentinel into a node label:\n' + graph);
});

check('sentenceMermaidGraph resolves related ids within each token\'s own context (sentence spanning two contexts)', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[1], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  // Troiae (n0, context 1.2) and qui (n1, context 1.2) both relate to primus (n2, context 1.2)
  assert.ok(graph.indexOf('n0 -->|place from which| n2') !== -1, graph);
  assert.ok(graph.indexOf('n1 -->|subject| n2') !== -1, graph);
  // ab (n3, context 1.3) relates to oris (n4, context 1.3) within the same context
  assert.ok(graph.indexOf('n3 -->|preposition| n4') !== -1, graph);
  // exactly 3 edges: nothing in context 1.3 can resolve back to primus in 1.2
  // (a bare token id is only unique - and therefore only resolvable - within
  // its own context), so no 4th edge should appear.
  var edgeCount = (graph.match(/-->/g) || []).length;
  assert.strictEqual(edgeCount, 3, 'expected exactly 3 edges, got ' + edgeCount + ':\n' + graph);
});

check('sentenceMermaidGraph escapes quotes and pipes so they cannot break the diagram syntax', function () {
  var slice = [
    { context: 'urn:cts:test:work:1', id: 't0', tokentype: 'lexical', text: 'foo"bar', related1: 't1', relationship1: 'weird|label' },
    { context: 'urn:cts:test:work:1', id: 't1', tokentype: 'lexical', text: 'baz' }
  ];
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  assert.ok(graph.indexOf('foo&quot;bar') !== -1, graph);
  assert.ok(graph.indexOf('weird/label') !== -1, graph);
  assert.strictEqual(graph.indexOf('foo"bar'), -1, graph);
  assert.strictEqual(graph.indexOf('weird|label'), -1, graph);
});

check('sentenceMermaidGraph returns {diagram, warnings}, with warnings empty when nothing is amiss', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var result = ArsGrammatica.sentenceMermaidGraph(slice);
  assert.strictEqual(typeof result.diagram, 'string');
  assert.deepStrictEqual(result.warnings, []);
});

// -- verbal unit coloring (assignVerbalUnits / assignVerbalUnitColors) ---

var VU_CONTEXT = 'urn:cts:test:work:1';

check('ArsGrammatica.verbalUnitPalette exposes 8 pastel {fill, stroke, text} colors', function () {
  assert.strictEqual(ArsGrammatica.verbalUnitPalette.length, 8);
  ArsGrammatica.verbalUnitPalette.forEach(function (color) {
    assert.ok(/^#[0-9a-f]{6}$/i.test(color.fill), JSON.stringify(color));
    assert.ok(/^#[0-9a-f]{6}$/i.test(color.stroke), JSON.stringify(color));
    assert.ok(/^#[0-9a-f]{6}$/i.test(color.text), JSON.stringify(color));
  });
});

check('assignVerbalUnits assigns every token in a single clause to its anchor\'s unit', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var assignment = ArsGrammatica.assignVerbalUnits(slice);
  var canoKey = slice[3].context + '\u241F' + slice[3].id; // cano is its own anchor
  // Every word (Arma, virum, que, cano) belongs to cano's unit; the
  // trailing period (last in the slice) has no relatedN of its own at
  // all, so it stays unresolved -- checked separately, below.
  slice.slice(0, -1).forEach(function (token) {
    var key = token.context + '\u241F' + token.id;
    assert.strictEqual(assignment.get(key), canoKey, token.text + ' should belong to cano\'s verbal unit');
  });
  var periodToken = slice[slice.length - 1];
  assert.strictEqual(periodToken.tokentype, 'punctuation');
  var periodKey = periodToken.context + '\u241F' + periodToken.id;
  assert.strictEqual(assignment.get(periodKey), null, 'the period has no relatedN of its own, so it should stay unresolved');
});

check('sentenceMermaidGraph colors every node of a single-clause sentence with one classDef/class pair', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  assert.ok(graph.indexOf('classDef vu0 fill:#82bbff,stroke:#2a78d6,color:#000000;') !== -1, graph);
  assert.ok(graph.indexOf('class n0,n1,n2,n3 vu0;') !== -1, graph);
});

check('colorByVerbalUnit: false omits all classDef/class styling', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice, { colorByVerbalUnit: false }).diagram;
  assert.strictEqual(graph.indexOf('classDef'), -1, graph);
  assert.strictEqual(graph.indexOf('class n'), -1, graph);
});

check('multiple verbal units get distinct colors in first-appearance order among rendered nodes', function () {
  // Two independent clauses, "a" anchored by verb0, "b" anchored by verb1;
  // verb1's clause appears first among the tokens, so it should claim the
  // first palette color even though it's the second token defined here.
  var slice = [
    { context: VU_CONTEXT, id: 't0', tokentype: 'lexical', text: 'firstclause', verbalunit: 't0' },
    { context: VU_CONTEXT, id: 't1', tokentype: 'lexical', text: 'secondclause', verbalunit: 't1' }
  ];
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  assert.ok(graph.indexOf('classDef vu0 fill:#82bbff,stroke:#2a78d6,color:#000000;') !== -1, graph);
  assert.ok(graph.indexOf('class n0 vu0;') !== -1, graph);
  assert.ok(graph.indexOf('classDef vu1 fill:#ffa682,stroke:#eb6834,color:#000000;') !== -1, graph);
  assert.ok(graph.indexOf('class n1 vu1;') !== -1, graph);
});

check('a token with no reachable verbal-unit anchor gets no classDef/class styling', function () {
  var slice = [
    { context: VU_CONTEXT, id: 't0', tokentype: 'lexical', text: 'anchored', verbalunit: 't0' },
    { context: VU_CONTEXT, id: 't1', tokentype: 'lexical', text: 'unanchored' }
  ];
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  assert.ok(graph.indexOf('class n0 vu0;') !== -1, graph);
  assert.strictEqual(graph.indexOf('n1 vu'), -1, 'the unanchored token should not appear in any class line:\n' + graph);
});

check('assignVerbalUnits: "unit verb" reverse link lets a clause verb claim a connective token pointing outward at a different clause', function () {
  // "vir, qui venit, regnat" (the man who came, rules): qui's own
  // outgoing relation points at vir (the main clause), but venit
  // (qui's own clause's verb) explicitly claims qui via a "unit verb"
  // edge, so qui should belong to venit's unit, not regnat's.
  var slice = [
    { context: VU_CONTEXT, id: 't0', tokentype: 'lexical', text: 'vir', related1: 't2', relationship1: 'subject' },
    { context: VU_CONTEXT, id: 't1', tokentype: 'lexical', text: 'qui', related1: 't0', relationship1: 'antecedent' },
    { context: VU_CONTEXT, id: 't2', tokentype: 'lexical', text: 'regnat', verbalunit: 't2', related1: 'root', relationship1: 'unit verb' },
    { context: VU_CONTEXT, id: 't3', tokentype: 'lexical', text: 'venit', verbalunit: 't3', related1: 't1', relationship1: 'unit verb' }
  ];
  var assignment = ArsGrammatica.assignVerbalUnits(slice);
  var key = function (i) { return VU_CONTEXT + '\u241F' + 't' + i; };
  assert.strictEqual(assignment.get(key(0)), key(2), 'vir should belong to regnat\'s unit');
  assert.strictEqual(assignment.get(key(1)), key(3), 'qui should belong to venit\'s unit via the "unit verb" reverse link, not vir\'s outward-pointing relation');
  assert.strictEqual(assignment.get(key(3)), key(3), 'venit is its own anchor');
});

check('assignVerbalUnits: an "ablative absolute" token is pulled into the participle\'s unit even when its own relatedN chain dead-ends', function () {
  // "urbe et castris captis, milites discesserunt": urbe's own outgoing
  // relation points at its unreachable coordinate "castris", not at the
  // participle -- only captis's reverse "circumstantial participle"
  // pointer (combined with urbe's own "ablative absolute" relationship)
  // connects urbe to the clause.
  var slice = [
    { context: VU_CONTEXT, id: 't0', tokentype: 'lexical', text: 'urbe', related1: 't1', relationship1: 'ablative absolute' },
    { context: VU_CONTEXT, id: 't1', tokentype: 'lexical', text: 'castris' },
    { context: VU_CONTEXT, id: 't2', tokentype: 'lexical', text: 'captis', verbalunit: 't2', related1: 't0', relationship1: 'circumstantial participle' },
    { context: VU_CONTEXT, id: 't3', tokentype: 'lexical', text: 'milites', related1: 't4', relationship1: 'subject' },
    { context: VU_CONTEXT, id: 't4', tokentype: 'lexical', text: 'discesserunt', verbalunit: 't4', related1: 'root', relationship1: 'unit verb' }
  ];
  var assignment = ArsGrammatica.assignVerbalUnits(slice);
  var key = function (i) { return VU_CONTEXT + '\u241F' + 't' + i; };
  assert.strictEqual(assignment.get(key(0)), key(2), 'urbe should be pulled into captis\'s unit via the ablative-absolute wrinkle');
  assert.strictEqual(assignment.get(key(1)), null, 'castris has no path to any anchor and should stay unresolved');
  assert.strictEqual(assignment.get(key(2)), key(2), 'captis is its own anchor');
});

check('assignVerbalUnits does not loop forever on a relation cycle with no anchor', function () {
  var slice = [
    { context: VU_CONTEXT, id: 't0', tokentype: 'lexical', text: 'a', related1: 't1', relationship1: 'x' },
    { context: VU_CONTEXT, id: 't1', tokentype: 'lexical', text: 'b', related1: 't0', relationship1: 'y' }
  ];
  var assignment = ArsGrammatica.assignVerbalUnits(slice);
  var key = function (i) { return VU_CONTEXT + '\u241F' + 't' + i; };
  assert.strictEqual(assignment.get(key(0)), null);
  assert.strictEqual(assignment.get(key(1)), null);
});

check('more than 8 distinct verbal units triggers a warning and cycles the palette', function () {
  var slice = [];
  for (var i = 0; i < 9; i++) {
    slice.push({ context: VU_CONTEXT, id: 't' + i, tokentype: 'lexical', text: 'w' + i, verbalunit: 't' + i });
  }
  var result = ArsGrammatica.sentenceMermaidGraph(slice);
  assert.strictEqual(result.warnings.length, 1);
  assert.ok(/9 verbal units but only 8 distinct colors/.test(result.warnings[0]), result.warnings[0]);
  // the 9th unit (index 8) reuses the palette's first color (index 8 % 8 === 0)
  assert.ok(result.diagram.indexOf('classDef vu8 fill:#82bbff,stroke:#2a78d6,color:#000000;') !== -1, result.diagram);
});

check('assignVerbalUnitColors can be called directly on a token list and an assignment map', function () {
  var slice = [
    { context: VU_CONTEXT, id: 't0', tokentype: 'lexical', text: 'a', verbalunit: 't0' },
    { context: VU_CONTEXT, id: 't1', tokentype: 'punctuation', text: '.' }
  ];
  var assignment = ArsGrammatica.assignVerbalUnits(slice);
  var colorResult = ArsGrammatica.assignVerbalUnitColors(slice, assignment);
  assert.strictEqual(colorResult.order.length, 1);
  assert.deepStrictEqual(colorResult.warnings, []);
  var key = VU_CONTEXT + '\u241F' + 't0';
  assert.deepStrictEqual(colorResult.colors.get(key), { fill: '#82bbff', stroke: '#2a78d6', text: '#000000' });
});

// -- sentenceHtml (colored-by-verbal-unit text view) --------------------

check('sentenceHtml matches sentenceText\'s wording and spacing exactly, once tags are stripped', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var plainText = ArsGrammatica.sentenceText(slice);
  var htmlResult = ArsGrammatica.sentenceHtml(slice);
  var stripped = htmlResult.html.replace(/<[^>]+>/g, '');
  assert.strictEqual(stripped, plainText);
});

check('sentenceHtml rejects an empty token slice', function () {
  assert.throws(function () {
    ArsGrammatica.sentenceHtml([]);
  }, /token slice is empty/);
});

check('sentenceHtml wraps every token of a single-clause sentence in the same vu0 span', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var html = ArsGrammatica.sentenceHtml(slice).html;
  ['Arma', 'virum', 'que', 'cano'].forEach(function (text) {
    var re = new RegExp('<span class="vu vu0" style="background-color:#82bbff;color:#000000;border:1px solid #2a78d6;[^"]*">' + text + '</span>');
    assert.ok(re.test(html), 'missing colored span for "' + text + '" in:\n' + html);
  });
  // the trailing period has no relatedN of its own, so it should be
  // plain, unwrapped text, not a span
  assert.ok(/>\.$|\.$/.test(html.trim()), 'expected the sentence to end in a bare, unwrapped period:\n' + html);
  assert.strictEqual((html.match(/<span/g) || []).length, 4, 'expected exactly 4 colored spans (period excluded):\n' + html);
});

check('sentenceHtml colors match sentenceMermaidGraph\'s colors for the same sentence', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var html = ArsGrammatica.sentenceHtml(slice).html;
  var graph = ArsGrammatica.sentenceMermaidGraph(slice).diagram;
  assert.ok(graph.indexOf('classDef vu0 fill:#82bbff,stroke:#2a78d6,color:#000000;') !== -1, graph);
  assert.ok(html.indexOf('background-color:#82bbff;color:#000000;border:1px solid #2a78d6') !== -1, html);
});

check('colorByVerbalUnit: false on sentenceHtml renders plain, unwrapped, HTML-escaped text', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var html = ArsGrammatica.sentenceHtml(slice, { colorByVerbalUnit: false }).html;
  assert.strictEqual(html.indexOf('<span'), -1, html);
  assert.strictEqual(html, 'Arma virumque cano.');
});

check('sentenceHtml HTML-escapes token text so it cannot inject markup', function () {
  var slice = [
    { context: 'urn:cts:test:work:1', id: 't0', tokentype: 'lexical', text: '<b>&"\'</b>' }
  ];
  var html = ArsGrammatica.sentenceHtml(slice).html;
  assert.strictEqual(html.indexOf('<b>'), -1, html);
  assert.ok(html.indexOf('&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;') !== -1, html);
});

check('sentenceHtml: a token with no reachable verbal-unit anchor is rendered as plain, unwrapped text', function () {
  var slice = [
    { context: VU_CONTEXT, id: 't0', tokentype: 'lexical', text: 'anchored', verbalunit: 't0' },
    { context: VU_CONTEXT, id: 't1', tokentype: 'lexical', text: 'unanchored' }
  ];
  var html = ArsGrammatica.sentenceHtml(slice).html;
  assert.strictEqual((html.match(/<span/g) || []).length, 1, html);
  assert.ok(html.indexOf('>unanchored<') === -1 && / unanchored$/.test(html), 'expected "unanchored" to appear as bare trailing text:\n' + html);
});

check('sentenceHtml surfaces the same >8-verbal-units warning as sentenceMermaidGraph', function () {
  var slice = [];
  for (var i = 0; i < 9; i++) {
    slice.push({ context: VU_CONTEXT, id: 't' + i, tokentype: 'lexical', text: 'w' + i, verbalunit: 't' + i });
  }
  var result = ArsGrammatica.sentenceHtml(slice);
  assert.strictEqual(result.warnings.length, 1);
  assert.ok(/9 verbal units but only 8 distinct colors/.test(result.warnings[0]), result.warnings[0]);
});

check('sentenceHtml respects a custom noSpaceBefore option, same as sentenceText', function () {
  var alwaysSpace = function () { return false; };
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var html = ArsGrammatica.sentenceHtml(slice, { noSpaceBefore: alwaysSpace, colorByVerbalUnit: false }).html;
  assert.strictEqual(html, ' Arma virum que cano .');
});

console.log('\n' + passed + ' check(s) passed.');

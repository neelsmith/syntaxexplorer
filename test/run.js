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
  var graph = ArsGrammatica.sentenceMermaidGraph(slice);
  assert.ok(graph.indexOf('graph BT\n') === 0, 'expected graph to start with "graph BT", got: ' + JSON.stringify(graph.slice(0, 20)));
});

check('ArsGrammatica.defaultExcludedTokenTypes exposes the default exclusion list', function () {
  assert.deepStrictEqual(ArsGrammatica.defaultExcludedTokenTypes, ['punctuation']);
});

check('sentenceMermaidGraph accepts TB/LR/RL orientation', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  ['TB', 'LR', 'RL'].forEach(function (orientation) {
    var graph = ArsGrammatica.sentenceMermaidGraph(slice, { orientation: orientation });
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
  var graph = ArsGrammatica.sentenceMermaidGraph(slice);
  ['Arma', 'virum', 'que', 'cano'].forEach(function (text, i) {
    assert.ok(graph.indexOf('n' + i + '["' + text + '"]') !== -1, 'missing node for "' + text + '" in:\n' + graph);
  });
});

check('sentenceMermaidGraph excludes punctuation tokens by default', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice);
  assert.strictEqual(graph.indexOf('["."]'), -1, 'a node for the period should not be present by default:\n' + graph);
  var nodeCount = (graph.match(/^  n\d+\[/gm) || []).length;
  assert.strictEqual(nodeCount, 4, 'expected 4 nodes (punctuation excluded), got ' + nodeCount + ':\n' + graph);
});

check('sentenceMermaidGraph can include punctuation via excludeTokenTypes: []', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice, { excludeTokenTypes: [] });
  assert.ok(graph.indexOf('["."]') !== -1, 'expected a node for the period when excludeTokenTypes is empty:\n' + graph);
  var nodeCount = (graph.match(/^  n\d+\[/gm) || []).length;
  assert.strictEqual(nodeCount, 5, 'expected 5 nodes (nothing excluded), got ' + nodeCount + ':\n' + graph);
});

check('sentenceMermaidGraph drops an edge whose relatedN points at an excluded (punctuation) token', function () {
  var slice = [
    { context: 'urn:cts:test:work:1', id: 't0', tokentype: 'lexical', text: 'foo', related1: 't1', relationship1: 'points at punctuation' },
    { context: 'urn:cts:test:work:1', id: 't1', tokentype: 'punctuation', text: '.' }
  ];
  var graph = ArsGrammatica.sentenceMermaidGraph(slice);
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
  var graph = ArsGrammatica.sentenceMermaidGraph(slice);
  // arma (n0) and virum (n1) are both direct objects of cano (n3)
  assert.ok(graph.indexOf('n0 -->|direct object| n3') !== -1, graph);
  assert.ok(graph.indexOf('n1 -->|direct object| n3') !== -1, graph);
  // que (n2) coordinates both arma (n0) and virum (n1) via its two related/relationship pairs
  assert.ok(graph.indexOf('n2 -->|coordinating conjunction| n0') !== -1, graph);
  assert.ok(graph.indexOf('n2 -->|coordinating conjunction| n1') !== -1, graph);
});

check('sentenceMermaidGraph skips a related1 value that does not resolve to a token in the sentence (e.g. the "root" sentinel)', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[0], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice);
  // cano (n3, related1="root") must not produce an edge to a fabricated "root" node
  assert.strictEqual(graph.indexOf('-->|unit verb|'), -1, 'should not have turned the "root" sentinel into an edge:\n' + graph);
  assert.strictEqual(graph.indexOf('"root"'), -1, 'should not have turned the "root" sentinel into a node label:\n' + graph);
});

check('sentenceMermaidGraph resolves related ids within each token\'s own context (sentence spanning two contexts)', function () {
  var slice = ArsGrammatica.tokensForSentence(parsed.tokens, parsed.sentences[1], tokenIndex);
  var graph = ArsGrammatica.sentenceMermaidGraph(slice);
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
  var graph = ArsGrammatica.sentenceMermaidGraph(slice);
  assert.ok(graph.indexOf('foo&quot;bar') !== -1, graph);
  assert.ok(graph.indexOf('weird/label') !== -1, graph);
  assert.strictEqual(graph.indexOf('foo"bar'), -1, graph);
  assert.strictEqual(graph.indexOf('weird|label'), -1, graph);
});

console.log('\n' + passed + ' check(s) passed.');

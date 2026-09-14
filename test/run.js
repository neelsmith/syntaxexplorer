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

console.log('\n' + passed + ' check(s) passed.');

/**
 * arsgrammatica.js
 *
 * Library functions for reading and working with syntactic analyses
 * saved by `arsgrammatica` in its plain-text serialization format
 * (documented at
 * https://neelsmith.github.io/arsgrammatica/reference/analysisformat.html).
 *
 * A saved analysis is a plain-text file made up of one or more blocks.
 * Each block begins with a line of the form `#!blockname`, followed by
 * a header line and then zero or more data lines, all delimited with a
 * fixed delimiter (`|` by default). Blank lines and lines beginning with
 * `//` are ignored. For example:
 *
 *   #!sentences
 *   context_begin|first_token|context_end|last_token
 *   urn:cts:latinLit:phi0690.phi003.omar:1.1|t0|urn:cts:latinLit:phi0690.phi003.omar:1.1|t3
 *
 *   #!tokens
 *   context|id|tokentype|text|lemma|verbalunit|related1|relationship1|related2|relationship2
 *   urn:cts:latinLit:phi0690.phi003.omar:1.1|t0|lexical|arma|arma||t3|direct object||
 *   ...
 *
 * This initial version of the library only needs structured access to
 * the `#!tokens` and `#!sentences` blocks, so those two are parsed into
 * arrays of plain objects keyed by their header column names. Other
 * blocks that may be present in a file (e.g. `#!verbal_units`, `#!lm`)
 * are not assumed to share the same delimited-table shape, so they are
 * simply left alone; `parseAnalysis` reports their names so callers can
 * tell they were present.
 *
 * Design notes, and the rationale for the token/sentence/text helpers
 * below, are written up in notes/library-api.md.
 *
 * Loading:
 *   - In a browser, include with a plain <script src="arsgrammatica.js"></script>
 *     (no <script type="module">), so pages using this library keep
 *     working when opened directly from disk (a file:// URL) with no
 *     web server. It attaches a single global, `ArsGrammatica`.
 *   - In Node (e.g. for tests), `require('./arsgrammatica.js')` returns
 *     the same object.
 *   - If `cts-urn.js` is also loaded (as `CtsUrn`), `sentenceLabel` uses
 *     it to compute passage components; otherwise it falls back to a
 *     simple split on ":".
 */
(function (global) {
  'use strict';

  // ---------------------------------------------------------------------
  // Parsing saved analysis files
  // ---------------------------------------------------------------------

  /**
   * Split the full text of a saved analysis into named blocks.
   *
   * Lines starting with "#!" introduce a new block (the block's name is
   * everything after "#!", trimmed). Blank lines and lines starting with
   * "//" are ignored everywhere. Lines before the first block header are
   * ignored.
   *
   * @param {string} text - full contents of a saved analysis file.
   * @returns {Object<string, string[]>} map of block name -> array of
   *   raw (non-blank, non-comment) lines belonging to that block, in
   *   file order, not including the "#!name" header line itself.
   */
  function splitBlocks(text) {
    if (typeof text !== 'string') {
      throw new TypeError('splitBlocks: expected a string, got ' + typeof text);
    }
    var lines = text.split(/\r\n|\r|\n/);
    var blocks = {};
    var currentName = null;

    lines.forEach(function (line) {
      var trimmed = line.trim();
      if (trimmed.indexOf('#!') === 0) {
        currentName = trimmed.slice(2).trim();
        if (!blocks[currentName]) {
          blocks[currentName] = [];
        }
        return;
      }
      if (trimmed === '' || trimmed.indexOf('//') === 0) {
        return;
      }
      if (currentName === null) {
        return; // ignore stray content before any block header
      }
      blocks[currentName].push(line);
    });

    return blocks;
  }

  /**
   * Parse a block's lines as a delimited table: the first line is a
   * header of column names, and each subsequent line is a data row with
   * the same delimiter, converted to an object keyed by column name.
   *
   * @param {string[]} lines - lines for one block, as returned by splitBlocks.
   * @param {string} [delimiter='|']
   * @returns {{header: string[], rows: Object<string,string>[]}}
   */
  function parseDelimitedBlock(lines, delimiter) {
    delimiter = delimiter || '|';
    if (!lines || lines.length === 0) {
      return { header: [], rows: [] };
    }
    var header = lines[0].split(delimiter).map(function (s) {
      return s.trim();
    });
    var rows = lines.slice(1).map(function (line) {
      var cells = line.split(delimiter);
      var record = {};
      header.forEach(function (key, i) {
        record[key] = (cells[i] !== undefined ? cells[i] : '').trim();
      });
      return record;
    });
    return { header: header, rows: rows };
  }

  /**
   * Parse the full text of a saved arsgrammatica analysis, extracting
   * the `#!tokens` and `#!sentences` blocks as arrays of row objects.
   *
   * @param {string} text - full contents of a saved analysis file.
   * @param {{delimiter?: string}} [options]
   * @returns {{
   *   tokens: Object[],
   *   sentences: Object[],
   *   tokensHeader: string[],
   *   sentencesHeader: string[],
   *   blockNames: string[]
   * }}
   */
  function parseAnalysis(text, options) {
    options = options || {};
    var delimiter = options.delimiter || '|';
    var rawBlocks = splitBlocks(text);

    var tokensBlock = parseDelimitedBlock(rawBlocks.tokens, delimiter);
    var sentencesBlock = parseDelimitedBlock(rawBlocks.sentences, delimiter);

    return {
      tokens: tokensBlock.rows,
      sentences: sentencesBlock.rows,
      tokensHeader: tokensBlock.header,
      sentencesHeader: sentencesBlock.header,
      blockNames: Object.keys(rawBlocks)
    };
  }

  // ---------------------------------------------------------------------
  // Working with tokens and sentences
  // ---------------------------------------------------------------------

  var KEY_SEPARATOR = '␟'; // unlikely to occur in real context/id values

  function tokenKey(context, id) {
    return String(context) + KEY_SEPARATOR + String(id);
  }

  /**
   * Build a lookup index from (context, id) to a token's position in
   * the tokens array, so that repeated lookups (e.g. once per sentence)
   * don't each require a linear scan.
   *
   * @param {Object[]} tokens - array of token rows, as returned by parseAnalysis.
   * @returns {Map<string, number>}
   */
  function indexTokens(tokens) {
    var map = new Map();
    tokens.forEach(function (token, i) {
      map.set(tokenKey(token.context, token.id), i);
    });
    return map;
  }

  /**
   * Extract the tokens belonging to a single sentence.
   *
   * Each sentence record identifies its first and last token by
   * (context_begin, first_token) and (context_end, last_token) pairs.
   * Because the token list is ordered, the sentence's tokens are the
   * inclusive slice of the token list between those two tokens.
   *
   * @param {Object[]} tokens - full ordered array of token rows.
   * @param {Object} sentence - a sentence row (with context_begin,
   *   first_token, context_end, last_token fields).
   * @param {Map<string, number>} [tokenIndex] - an index built by
   *   indexTokens(tokens); built on the fly if omitted (build it once
   *   yourself and pass it in when calling this for many sentences).
   * @returns {Object[]} the inclusive slice of `tokens` for this sentence.
   */
  function tokensForSentence(tokens, sentence, tokenIndex) {
    var idx = tokenIndex || indexTokens(tokens);

    var startKey = tokenKey(sentence.context_begin, sentence.first_token);
    var endKey = tokenKey(sentence.context_end, sentence.last_token);

    var startIdx = idx.get(startKey);
    var endIdx = idx.get(endKey);

    if (startIdx === undefined) {
      throw new Error(
        'tokensForSentence: could not find first token (context="' +
          sentence.context_begin +
          '", id="' +
          sentence.first_token +
          '") in the token list'
      );
    }
    if (endIdx === undefined) {
      throw new Error(
        'tokensForSentence: could not find last token (context="' +
          sentence.context_end +
          '", id="' +
          sentence.last_token +
          '") in the token list'
      );
    }
    if (endIdx < startIdx) {
      throw new Error(
        'tokensForSentence: last token appears before first token in the ordered token list'
      );
    }

    return tokens.slice(startIdx, endIdx + 1);
  }

  // ---------------------------------------------------------------------
  // Rendering a "black text" view (surface text) of a run of tokens
  // ---------------------------------------------------------------------

  // Punctuation that normally attaches to the *preceding* token with no
  // space (closing/trailing marks): . , ; : ! ? ) ] } and closing quotes.
  var TRAILING_PUNCTUATION = /^[.,;:!?)\]}'"»›”’·…]+$/;

  // Punctuation that normally has no space *after* it, before the next
  // token (opening marks): ( [ { and opening quotes.
  var OPENING_PUNCTUATION = /^[([{'"«‹“‘]+$/;

  /**
   * Default rule for whether a space should be suppressed before `token`,
   * given the `previous` token (or null/undefined if `token` is first).
   * Exposed so callers can override it via the `noSpaceBefore` option of
   * sentenceText/sentenceLabel for a different language's conventions.
   *
   * @param {Object} token
   * @param {Object} [previous]
   * @returns {boolean}
   */
  function defaultNoSpaceBefore(token, previous) {
    if (!previous) {
      return true; // never a leading space before the first token
    }
    var text = token.text || '';
    var tokentype = (token.tokentype || '').toLowerCase();

    if (tokentype === 'enclitic') {
      return true; // e.g. "virum" + "que" -> "virumque"
    }
    if (tokentype === 'punctuation' && TRAILING_PUNCTUATION.test(text)) {
      return true;
    }

    var prevText = previous.text || '';
    var prevType = (previous.tokentype || '').toLowerCase();
    if (prevType === 'punctuation' && OPENING_PUNCTUATION.test(prevText)) {
      return true; // no space right after an opening quote/paren
    }

    return false;
  }

  /**
   * Build the "black text" (plain surface text) of a run of tokens, by
   * concatenating each token's `text` value and inserting whitespace
   * between tokens except where that would be wrong (e.g. before a
   * following period, or between an enclitic and its host word).
   *
   * @param {Object[]} tokenSlice - an ordered array of token rows, e.g.
   *   as returned by tokensForSentence.
   * @param {{noSpaceBefore?: function(Object, Object=): boolean}} [options]
   * @returns {string}
   */
  function sentenceText(tokenSlice, options) {
    options = options || {};
    var noSpaceBefore = options.noSpaceBefore || defaultNoSpaceBefore;

    var result = '';
    var previous = null;
    tokenSlice.forEach(function (token) {
      var text = token.text || '';
      if (text === '') {
        return; // nothing to render for this token, but it still counts
                // as "previous" context-wise... in practice tokens always
                // have text, so this is just a defensive no-op.
      }
      if (!noSpaceBefore(token, previous)) {
        result += ' ';
      }
      result += text;
      previous = token;
    });
    return result;
  }

  function lookupCtsUrn() {
    return (global && global.CtsUrn) || (typeof globalThis !== 'undefined' && globalThis.CtsUrn) || null;
  }

  function fallbackPassageComponent(urn) {
    var parts = String(urn).split(':');
    return parts[parts.length - 1];
  }

  /**
   * Build a menu label for a sentence: the passage component of its
   * starting token's CTS URN, followed by the black-text view of its
   * first `maxTokens` tokens, followed by an ellipsis if the sentence
   * has more tokens than that.
   *
   * @param {Object[]} tokenSlice - full ordered token slice for one
   *   sentence, e.g. as returned by tokensForSentence. Must be non-empty.
   * @param {{maxTokens?: number, separator?: string, ellipsis?: string}} [options]
   * @returns {string}
   */
  function sentenceLabel(tokenSlice, options) {
    options = options || {};
    var maxTokens = options.maxTokens || 4;
    var separator = options.separator !== undefined ? options.separator : ': ';
    var ellipsis = options.ellipsis !== undefined ? options.ellipsis : '…';

    if (!tokenSlice || tokenSlice.length === 0) {
      throw new Error('sentenceLabel: token slice is empty');
    }

    var ctsUrn = lookupCtsUrn();
    var passage;
    try {
      passage = ctsUrn
        ? ctsUrn.passageComponent(tokenSlice[0].context)
        : fallbackPassageComponent(tokenSlice[0].context);
    } catch (err) {
      passage = tokenSlice[0].context;
    }

    var preview = sentenceText(tokenSlice.slice(0, maxTokens), options);
    var truncated = tokenSlice.length > maxTokens;

    return passage + separator + preview + (truncated ? ' ' + ellipsis : '');
  }

  // ---------------------------------------------------------------------
  // Rendering a sentence's dependency relations as a Mermaid graph
  // ---------------------------------------------------------------------

  var VALID_GRAPH_ORIENTATIONS = ['TB', 'BT', 'LR', 'RL'];

  function sanitizeMermaidText(text) {
    return String(text)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '&quot;')
      .replace(/[\r\n]+/g, ' ')
      .trim();
  }

  function sanitizeMermaidEdgeLabel(text) {
    return sanitizeMermaidText(text).replace(/\|/g, '/');
  }

  var DEFAULT_EXCLUDED_TOKEN_TYPES = ['punctuation'];

  /**
   * Build a Mermaid `graph` definition showing a sentence's internal
   * syntactic relations, using the `related1`/`relationship1` and
   * `related2`/`relationship2` columns of its tokens: `relatedN` names
   * the `id` (within that token's own `context`) of another token in
   * the sentence it connects to, and `relationshipN` labels that
   * connection.
   *
   * Every token in `tokenSlice` becomes a node (labelled with its
   * surface `text`), except tokens whose `tokentype` is in
   * `excludeTokenTypes` (case-insensitive; defaults to `["punctuation"]`,
   * since punctuation tokens are essentially never meaningful nodes in
   * a dependency graph and rarely carry any relations of their own).
   * Pass `excludeTokenTypes: []` to include every token, punctuation
   * included. An edge is drawn for each `relatedN` value that resolves
   * to another *included* token in the same sentence (matched by that
   * token's own `context` plus the `relatedN` id, since ids are only
   * guaranteed unique within a context); a `relatedN` value that does
   * not resolve to any included token in the slice — either because
   * it's a sentinel value such as "root" that some analyses use to
   * flag a sentence's syntactic root, or because it names a token that
   * was excluded — is left out rather than fabricating a node for it.
   *
   * @param {Object[]} tokenSlice - full ordered token slice for one
   *   sentence, e.g. as returned by tokensForSentence. Must be non-empty.
   * @param {{orientation?: string, excludeTokenTypes?: string[]}} [options] -
   *   orientation is one of "TB", "BT" (default), "LR", "RL".
   *   excludeTokenTypes defaults to ["punctuation"].
   * @returns {string} a complete Mermaid `graph` definition.
   */
  function sentenceMermaidGraph(tokenSlice, options) {
    options = options || {};
    var orientation = options.orientation || 'BT';
    if (VALID_GRAPH_ORIENTATIONS.indexOf(orientation) === -1) {
      throw new Error(
        'sentenceMermaidGraph: invalid orientation "' + orientation +
          '" (expected one of ' + VALID_GRAPH_ORIENTATIONS.join(', ') + ')'
      );
    }
    if (!tokenSlice || tokenSlice.length === 0) {
      throw new Error('sentenceMermaidGraph: token slice is empty');
    }

    var excludeTokenTypes = (options.excludeTokenTypes || DEFAULT_EXCLUDED_TOKEN_TYPES).map(function (t) {
      return String(t).toLowerCase();
    });

    var graphTokens = tokenSlice.filter(function (token) {
      return excludeTokenTypes.indexOf((token.tokentype || '').toLowerCase()) === -1;
    });

    if (graphTokens.length === 0) {
      throw new Error(
        'sentenceMermaidGraph: no tokens remain after excluding tokentypes: ' + excludeTokenTypes.join(', ')
      );
    }

    // Map each remaining token's (context, id) to a synthetic,
    // always-unique node id: a sentence's tokens can span more than one
    // context, and a token's own `id` is only guaranteed unique *within*
    // its context, so plain token ids could collide across contexts.
    // Excluded tokens (e.g. punctuation) are simply absent from this
    // map, so a relatedN value naming one resolves to nothing below,
    // the same as an unresolvable sentinel like "root".
    var nodeIdByKey = new Map();
    graphTokens.forEach(function (token, i) {
      nodeIdByKey.set(tokenKey(token.context, token.id), 'n' + i);
    });

    var nodeLines = [];
    var edgeLines = [];

    graphTokens.forEach(function (token, i) {
      var nodeId = 'n' + i;
      var label = sanitizeMermaidText(token.text || token.id || '');
      nodeLines.push(nodeId + '["' + label + '"]');

      [['related1', 'relationship1'], ['related2', 'relationship2']].forEach(function (pair) {
        var relatedId = (token[pair[0]] || '').trim();
        if (relatedId === '') {
          return;
        }
        var targetNodeId = nodeIdByKey.get(tokenKey(token.context, relatedId));
        if (!targetNodeId) {
          return; // doesn't resolve to an included token in this sentence; skip it
        }
        var relationship = (token[pair[1]] || '').trim();
        var arrow = relationship ? '-->|' + sanitizeMermaidEdgeLabel(relationship) + '|' : '-->';
        edgeLines.push(nodeId + ' ' + arrow + ' ' + targetNodeId);
      });
    });

    var body = nodeLines.concat(edgeLines)
      .map(function (line) { return '  ' + line; })
      .join('\n');

    return 'graph ' + orientation + '\n' + body + '\n';
  }

  // ---------------------------------------------------------------------

  var ArsGrammatica = {
    splitBlocks: splitBlocks,
    parseDelimitedBlock: parseDelimitedBlock,
    parseAnalysis: parseAnalysis,
    indexTokens: indexTokens,
    tokensForSentence: tokensForSentence,
    sentenceText: sentenceText,
    sentenceLabel: sentenceLabel,
    defaultNoSpaceBefore: defaultNoSpaceBefore,
    sentenceMermaidGraph: sentenceMermaidGraph,
    validGraphOrientations: VALID_GRAPH_ORIENTATIONS.slice(),
    defaultExcludedTokenTypes: DEFAULT_EXCLUDED_TOKEN_TYPES.slice()
  };

  global.ArsGrammatica = ArsGrammatica;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ArsGrammatica;
  }
})(typeof window !== 'undefined' ? window : globalThis);

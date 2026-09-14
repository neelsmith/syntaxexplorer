/**
 * syntaxer.js
 *
 * Library functions for reading and working with syntactic analyses
 * saved as plain text in a CEX-style serialization format -- the one
 * documented at
 * https://neelsmith.github.io/arsgrammatica/reference/analysisformat.html,
 * arsgrammatica being one tool (among others that could use the same
 * general style) that produces it.
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
 *   - In a browser, include with a plain <script src="syntaxer.js"></script>
 *     (no <script type="module">), so pages using this library keep
 *     working when opened directly from disk (a file:// URL) with no
 *     web server. It attaches a single global, `Syntaxer`.
 *   - In Node (e.g. for tests), `require('./syntaxer.js')` returns
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
   * Parse the full text of a saved analysis, extracting
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
   * When `colorByVerbalUnit` is true (the default), nodes are also
   * colored by the "verbal unit" subtree they belong to -- see
   * `assignVerbalUnits`, below -- using the same clustering rule and
   * pastel palette as arsgrammatica's own Python `mermaid.py`
   * (https://github.com/neelsmith/arsgrammatica), so a diagram built
   * here matches one built there. Pass `colorByVerbalUnit: false` to
   * skip coloring and leave every node with Mermaid's default styling.
   *
   * @param {Object[]} tokenSlice - full ordered token slice for one
   *   sentence, e.g. as returned by tokensForSentence. Must be non-empty.
   * @param {{orientation?: string, excludeTokenTypes?: string[], colorByVerbalUnit?: boolean}} [options] -
   *   orientation is one of "TB", "BT" (default), "LR", "RL".
   *   excludeTokenTypes defaults to ["punctuation"].
   *   colorByVerbalUnit defaults to true.
   * @returns {{diagram: string, warnings: string[]}} `diagram` is a
   *   complete Mermaid `graph` definition; `warnings` lists any
   *   non-fatal issues noticed while building it (currently: more
   *   distinct verbal units were found than the palette has colors
   *   for, so some units share a color).
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

    var colorByVerbalUnit = options.colorByVerbalUnit !== false;
    var warnings = [];

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

    var styleLines = [];
    if (colorByVerbalUnit) {
      var verbalUnitColoring = computeVerbalUnitColoring(tokenSlice, excludeTokenTypes);
      var assignment = verbalUnitColoring.assignment;
      var colorResult = verbalUnitColoring.colorResult;
      warnings = warnings.concat(colorResult.warnings);

      colorResult.order.forEach(function (unitKey, unitIndex) {
        var color = colorResult.colors.get(unitKey);
        var className = 'vu' + unitIndex;
        var memberNodeIds = [];
        graphTokens.forEach(function (token, i) {
          if (assignment.get(tokenKey(token.context, token.id)) === unitKey) {
            memberNodeIds.push('n' + i);
          }
        });
        if (memberNodeIds.length === 0) {
          return;
        }
        styleLines.push(
          'classDef ' + className + ' fill:' + color.fill + ',stroke:' + color.stroke + ',color:' + color.text + ';'
        );
        styleLines.push('class ' + memberNodeIds.join(',') + ' ' + className + ';');
      });
    }

    var bodyLines = nodeLines.concat(edgeLines);
    if (styleLines.length > 0) {
      bodyLines.push('');
      bodyLines = bodyLines.concat(styleLines);
    }

    var body = bodyLines
      .map(function (line) { return line === '' ? '' : '  ' + line; })
      .join('\n');

    return {
      diagram: 'graph ' + orientation + '\n' + body + '\n',
      warnings: warnings
    };
  }

  // ---------------------------------------------------------------------
  // Clustering tokens into "verbal units", and coloring them
  // ---------------------------------------------------------------------
  //
  // A "verbal unit" is a clause-like subtree of a sentence's tokens,
  // anchored by the one token whose own `verbalunit` field names its
  // own id (a saved analysis marks exactly one token per clause this
  // way).
  // Every other token in that clause belongs to the same unit, found by
  // walking its `related1`/`related2` chain up to that anchor.
  //
  // This is a port of `assign_verbal_units` and
  // `assign_verbal_unit_colors` in arsgrammatica's own Python
  // `arsgrammatica/verbal_units.py`
  // (https://github.com/neelsmith/arsgrammatica), adapted to this
  // library's `tokenKey(context, id)` convention in place of Python's
  // flat, globally-unique `id` lookup -- our token ids are only unique
  // within their own `context`, the same adaptation `sentenceMermaidGraph`
  // itself already makes for `relatedN` resolution, above. Two
  // deliberate "wrinkles" from the Python original are preserved:
  //
  //   - "unit verb" reverse link: a clause's own verb can explicitly
  //     claim a connective token (e.g. a relative pronoun or
  //     subordinating conjunction) as a member of its own clause by
  //     pointing *at* it with relationship "unit verb" -- overriding
  //     whatever that connective token's own relatedN chain would
  //     otherwise resolve to (often a token in a *different*, governing
  //     clause).
  //   - ablative absolute: a token pointed at by a "circumstantial
  //     participle" relationship resolves through that participle
  //     instead of its own relatedN chain, but only when the token
  //     itself also carries an "ablative absolute" relationship (on
  //     either related1/relationship1 or related2/relationship2);
  //     otherwise it falls through to the normal relatedN walk.
  //
  // Both wrinkles exist because a subordinate clause's connective word
  // frequently has its *own* outgoing relation pointing into the clause
  // it's subordinate *to*, not the clause it introduces, so resolving
  // strictly "outward" via relatedN would put it in the wrong unit.
  //
  // Deliberately out of scope (present in the Python original but not
  // requested here, and with no equivalent in this library's simpler
  // graph): "implied token" amber styling/shape, `rank_by_depth`
  // invisible depth-alignment links, `aat_depth`-based filtering, and a
  // dedicated `show_root` root node.

  var UNIT_VERB = 'unit verb';
  var CIRCUMSTANTIAL_PARTICIPLE = 'circumstantial participle';
  var ABLATIVE_ABSOLUTE = 'ablative absolute';

  // 8 pastel {fill, stroke} pairs (with black node text), in the exact
  // order arsgrammatica's own `_VERBAL_UNIT_PALETTE` uses, so a diagram
  // built here matches one built with the Python library.
  var VERBAL_UNIT_PALETTE = [
    { fill: '#82bbff', stroke: '#2a78d6', text: '#000000' }, // blue
    { fill: '#ffa682', stroke: '#eb6834', text: '#000000' }, // orange
    { fill: '#70ffcc', stroke: '#1baf7a', text: '#000000' }, // aqua
    { fill: '#ffd170', stroke: '#eda100', text: '#000000' }, // yellow
    { fill: '#ff94bc', stroke: '#e87ba4', text: '#000000' }, // magenta
    { fill: '#7aff7a', stroke: '#008300', text: '#000000' }, // green
    { fill: '#a494ff', stroke: '#4a3aa7', text: '#000000' }, // violet
    { fill: '#ff9594', stroke: '#e34948', text: '#000000' }  // red
  ];

  /**
   * Resolve every token in `tokenSlice` to the "verbal unit" it belongs
   * to, per the algorithm and wrinkles documented above.
   *
   * @param {Object[]} tokenSlice - full ordered token slice for one
   *   sentence (not pre-filtered by tokentype: resolution may need to
   *   walk through a token that would otherwise be excluded from the
   *   graph, e.g. punctuation).
   * @returns {Map<string, string|null>} maps each token's `tokenKey`
   *   (see the internal `tokenKey(context, id)` helper) to the
   *   `tokenKey` of the anchor token whose verbal unit it belongs to,
   *   or `null` if it couldn't be resolved (no anchor was reachable,
   *   e.g. because of a relation cycle with no anchor in it).
   */
  function assignVerbalUnits(tokenSlice) {
    var byKey = new Map();
    tokenSlice.forEach(function (token) {
      byKey.set(tokenKey(token.context, token.id), token);
    });

    // introducesClauseFor(target) / circumstantialParticipleFor(target)
    // map a target token's key to the key of a token that points *at*
    // it with relationship "unit verb" / "circumstantial participle"
    // respectively.
    var introducesClauseFor = new Map();
    var circumstantialParticipleFor = new Map();

    tokenSlice.forEach(function (token) {
      var ownKey = tokenKey(token.context, token.id);
      [['related1', 'relationship1'], ['related2', 'relationship2']].forEach(function (pair) {
        var related = (token[pair[0]] || '').trim();
        var label = (token[pair[1]] || '').trim();
        if (related === '' || related === 'root') {
          return;
        }
        var targetKey = tokenKey(token.context, related);
        if (label === UNIT_VERB) {
          introducesClauseFor.set(targetKey, ownKey);
        } else if (label === CIRCUMSTANTIAL_PARTICIPLE) {
          circumstantialParticipleFor.set(targetKey, ownKey);
        }
      });
    });

    var resolved = new Map();
    var inProgress = new Set();

    function resolve(key) {
      if (resolved.has(key)) {
        return resolved.get(key);
      }
      var token = byKey.get(key);
      if (!token) {
        return null;
      }
      var ownVerbalUnit = (token.verbalunit || '').trim();
      if (ownVerbalUnit !== '') {
        var anchorKey = tokenKey(token.context, ownVerbalUnit);
        resolved.set(key, anchorKey);
        return anchorKey;
      }
      if (inProgress.has(key)) {
        return null; // relation cycle with no anchor reached; bail out
      }
      inProgress.add(key);

      var result = null;
      var clauseVerbKey = introducesClauseFor.get(key);
      if (clauseVerbKey !== undefined) {
        result = resolve(clauseVerbKey);
      }
      if (result === null) {
        var participleKey = circumstantialParticipleFor.get(key);
        var isAblativeAbsolute =
          (token.relationship1 || '').trim() === ABLATIVE_ABSOLUTE ||
          (token.relationship2 || '').trim() === ABLATIVE_ABSOLUTE;
        if (participleKey !== undefined && isAblativeAbsolute) {
          result = resolve(participleKey);
        }
      }
      if (result === null) {
        [['related1'], ['related2']].some(function (pair) {
          var related = (token[pair[0]] || '').trim();
          if (related === '' || related === 'root') {
            return false;
          }
          result = resolve(tokenKey(token.context, related));
          return result !== null;
        });
      }

      inProgress.delete(key);
      resolved.set(key, result);
      return result;
    }

    var assignment = new Map();
    tokenSlice.forEach(function (token) {
      var key = tokenKey(token.context, token.id);
      assignment.set(key, resolve(key));
    });
    return assignment;
  }

  /**
   * Assign a palette color to each distinct verbal unit found among
   * `orderedTokens` (typically the tokens that will actually become
   * graph nodes), in first-appearance order, cycling through the
   * palette if there are more units than colors.
   *
   * @param {Object[]} orderedTokens - tokens in display order.
   * @param {Map<string, string|null>} assignment - as returned by
   *   assignVerbalUnits, called with the *full*, unfiltered sentence
   *   slice so resolution can walk through tokens that aren't in
   *   orderedTokens.
   * @returns {{colors: Map<string,{fill:string,stroke:string,text:string}>, order: string[], warnings: string[]}}
   */
  function assignVerbalUnitColors(orderedTokens, assignment) {
    var order = [];
    var seen = new Set();
    orderedTokens.forEach(function (token) {
      var key = tokenKey(token.context, token.id);
      var unitKey = assignment.get(key);
      if (unitKey && !seen.has(unitKey)) {
        seen.add(unitKey);
        order.push(unitKey);
      }
    });

    var warnings = [];
    if (order.length > VERBAL_UNIT_PALETTE.length) {
      warnings.push(
        order.length + ' verbal units but only ' + VERBAL_UNIT_PALETTE.length +
          ' distinct colors -- colors repeat and may be ambiguous between units'
      );
    }

    var colors = new Map();
    order.forEach(function (unitKey, i) {
      colors.set(unitKey, VERBAL_UNIT_PALETTE[i % VERBAL_UNIT_PALETTE.length]);
    });

    return { colors: colors, order: order, warnings: warnings };
  }

  /**
   * Compute a verbal-unit color assignment for `tokenSlice`, shared by
   * sentenceMermaidGraph and sentenceHtml so that the same sentence
   * (rendered with the same `excludeTokenTypes`) always gets the same
   * unit-to-color mapping in both views.
   *
   * @param {Object[]} tokenSlice - full, unfiltered sentence token slice.
   * @param {string[]} excludeTokenTypesLower - lower-cased tokentype
   *   values that don't count toward first-appearance color ordering
   *   (a token of one of these types can still end up colored, if some
   *   *other*, non-excluded token already established that unit's
   *   color first).
   * @returns {{assignment: Map<string,string|null>, colorResult: {colors: Map, order: string[], warnings: string[]}}}
   */
  function computeVerbalUnitColoring(tokenSlice, excludeTokenTypesLower) {
    var assignment = assignVerbalUnits(tokenSlice);
    var orderingTokens = tokenSlice.filter(function (token) {
      return excludeTokenTypesLower.indexOf((token.tokentype || '').toLowerCase()) === -1;
    });
    var colorResult = assignVerbalUnitColors(orderingTokens, assignment);
    return { assignment: assignment, colorResult: colorResult };
  }

  // ---------------------------------------------------------------------
  // Rendering a sentence's text as HTML, colored by verbal unit
  // ---------------------------------------------------------------------

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Build an HTML rendering of a sentence's "black text" -- the same
   * surface-text join sentenceText produces -- with *every* token
   * wrapped in a `<span>`, so the result is ready for
   * `enableTokenHover` (below) whether or not verbal-unit coloring is
   * also applied.
   *
   * Each span always carries `data-context`/`data-id` (identifying the
   * token itself) and, when its `related1`/`related2` resolves to
   * another token actually present in `tokenSlice`, `data-relatedN-id`
   * / `data-relationshipN` -- the same "root"-sentinel and
   * unresolvable-id skipping sentenceMermaidGraph's edges use, except
   * every token here gets a span (unlike the graph, which omits
   * excluded/punctuation tokens as nodes entirely), so a relatedN
   * value is only dropped here if it doesn't resolve to *any* token in
   * the slice at all.
   *
   * When `colorByVerbalUnit` is true (the default), a span whose
   * verbal unit could be resolved additionally gets a `class="vu vuN"`
   * and an inline `style` coloring it -- using the exact same
   * clustering and palette as sentenceMermaidGraph's own
   * `colorByVerbalUnit` coloring (pass the same `excludeTokenTypes` to
   * both functions, or leave both at their shared `["punctuation"]`
   * default, and the same verbal unit gets the same color in both a
   * sentence's graph and its text view). `colorByVerbalUnit: false`
   * skips that class/style -- every span is still present (for hover),
   * just uncolored.
   *
   * @param {Object[]} tokenSlice - full ordered token slice for one
   *   sentence, e.g. as returned by tokensForSentence. Must be non-empty.
   * @param {{noSpaceBefore?: function(Object, Object=): boolean, excludeTokenTypes?: string[], colorByVerbalUnit?: boolean}} [options] -
   *   `noSpaceBefore` is the same spacing hook sentenceText accepts.
   *   `excludeTokenTypes` (default `["punctuation"]`) does *not* remove
   *   any token from the rendered text -- every token in `tokenSlice`
   *   is shown, same as sentenceText -- it only controls which tokens
   *   count toward first-appearance color ordering, matching
   *   sentenceMermaidGraph's own option of the same name.
   *   `colorByVerbalUnit` (default true) set to false omits the
   *   coloring class/style from every span.
   * @returns {{html: string, warnings: string[]}} `html` is an HTML
   *   fragment with no wrapping element of its own -- insert it into
   *   any container via `.innerHTML`; `warnings` mirrors
   *   sentenceMermaidGraph's (more distinct verbal units were found
   *   than the palette has colors for).
   */
  function sentenceHtml(tokenSlice, options) {
    options = options || {};
    if (!tokenSlice || tokenSlice.length === 0) {
      throw new Error('sentenceHtml: token slice is empty');
    }

    var noSpaceBefore = options.noSpaceBefore || defaultNoSpaceBefore;
    var colorByVerbalUnit = options.colorByVerbalUnit !== false;
    var excludeTokenTypes = (options.excludeTokenTypes || DEFAULT_EXCLUDED_TOKEN_TYPES).map(function (t) {
      return String(t).toLowerCase();
    });

    var assignment = null;
    var colorResult = null;
    var warnings = [];
    if (colorByVerbalUnit) {
      var coloring = computeVerbalUnitColoring(tokenSlice, excludeTokenTypes);
      assignment = coloring.assignment;
      colorResult = coloring.colorResult;
      warnings = colorResult.warnings;
    }

    // Every token in this slice is a valid relatedN hover target, since
    // (unlike sentenceMermaidGraph's edges, which only connect
    // *rendered* nodes) every token gets a span here, punctuation
    // included.
    var presentKeys = new Set();
    tokenSlice.forEach(function (token) {
      presentKeys.add(tokenKey(token.context, token.id));
    });

    var html = '';
    var previous = null;
    tokenSlice.forEach(function (token) {
      var text = token.text || '';
      if (text === '') {
        return;
      }
      if (!noSpaceBefore(token, previous)) {
        html += ' ';
      }

      var classNames = ['ag-token'];
      var styleAttr = '';
      if (colorByVerbalUnit) {
        var unitKey = assignment.get(tokenKey(token.context, token.id));
        var color = unitKey ? colorResult.colors.get(unitKey) : null;
        if (color) {
          classNames.push('vu', 'vu' + colorResult.order.indexOf(unitKey));
          styleAttr =
            ' style="background-color:' + color.fill + ';color:' + color.text +
            ';border:1px solid ' + color.stroke + ';border-radius:3px;padding:0 0.15em;"';
        }
      }

      var dataAttrs =
        ' data-context="' + escapeHtml(token.context) + '" data-id="' + escapeHtml(token.id) + '"';
      [['related1', 'relationship1', 1], ['related2', 'relationship2', 2]].forEach(function (spec) {
        var relatedId = (token[spec[0]] || '').trim();
        var relationship = (token[spec[1]] || '').trim();
        if (relatedId === '' || relatedId === 'root') {
          return;
        }
        if (!presentKeys.has(tokenKey(token.context, relatedId))) {
          return; // doesn't resolve to any token in this sentence; skip it
        }
        dataAttrs += ' data-related' + spec[2] + '-id="' + escapeHtml(relatedId) + '"';
        if (relationship !== '') {
          dataAttrs += ' data-relationship' + spec[2] + '="' + escapeHtml(relationship) + '"';
        }
      });

      html +=
        '<span class="' + classNames.join(' ') + '"' + dataAttrs + styleAttr + '>' +
        escapeHtml(text) + '</span>';

      previous = token;
    });

    return { html: html, warnings: warnings };
  }

  // ---------------------------------------------------------------------
  // Interactive hover: highlighting related tokens on a sentenceHtml view
  // ---------------------------------------------------------------------

  var TOKEN_HOVER_STYLE_ID = 'ars-grammatica-token-hover-style';

  function ensureTokenHoverStyles() {
    if (typeof document === 'undefined' || document.getElementById(TOKEN_HOVER_STYLE_ID)) {
      return;
    }
    var style = document.createElement('style');
    style.id = TOKEN_HOVER_STYLE_ID;
    style.textContent =
      '.ag-token{cursor:default;}' +
      '.ag-token-hovered{outline:2px solid #1a1a1a;outline-offset:1px;}' +
      '.ag-token-related{outline:2px dashed #b45309;outline-offset:1px;}' +
      '@media (prefers-color-scheme: dark){' +
      '.ag-token-hovered{outline-color:#f2f2f2;}' +
      '.ag-token-related{outline-color:#f0b429;}' +
      '}' +
      '.ag-token-tooltip{position:fixed;z-index:2147483647;background:#1a1a1a;color:#fff;' +
      'font:12px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;padding:4px 8px;' +
      'border-radius:4px;pointer-events:none;max-width:280px;line-height:1.4;' +
      'box-shadow:0 2px 6px rgba(0,0,0,0.3);}' +
      '.ag-token-tooltip div + div{margin-top:2px;}';
    document.head.appendChild(style);
  }

  function cssEscapeAttrValue(value) {
    if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') {
      return CSS.escape(value);
    }
    return String(value).replace(/["\\]/g, '\\$&');
  }

  /**
   * Wire up hover interactivity on a container holding one or more
   * sentenceHtml-rendered sentences: hovering a token span
   * 1) highlights that token, 2) highlights every token directly
   * related to it -- its own resolved related1/related2 targets, and
   * any *other* token whose related1/related2 names it back -- and
   * 3) shows a small built-in tooltip naming each relationship, in the
   * same "source -> relationship -> target" direction
   * sentenceMermaidGraph's own edges use.
   *
   * Call this once on a persistent container element (e.g. the element
   * you assign sentenceHtml's `html` into) -- it listens on the
   * container itself via event delegation, so it keeps working after
   * the container's innerHTML is replaced with a new sentence's markup
   * (no need to call this again after re-rendering); calling it again
   * on the same container is a harmless no-op.
   *
   * @param {Element} container
   * @param {{tooltip?: boolean, onHover?: function({tokenElement: Element, relations: Object[]}), onUnhover?: function()}} [options] -
   *   `tooltip` (default true) set to false to skip the built-in
   *   tooltip (e.g. because the host page wants to show relations its
   *   own way, via `onHover`). Each entry of `relations` is
   *   `{direction: "outgoing"|"incoming", relationship: string, other: Element}`,
   *   `other` being the related token's own span.
   */
  function enableTokenHover(container, options) {
    if (typeof document === 'undefined') {
      throw new Error('enableTokenHover: requires a browser DOM (document is not defined)');
    }
    if (!container) {
      throw new Error('enableTokenHover: container is required');
    }
    options = options || {};
    var showTooltip = options.tooltip !== false;
    var onHover = typeof options.onHover === 'function' ? options.onHover : null;
    var onUnhover = typeof options.onUnhover === 'function' ? options.onUnhover : null;

    if (container.getAttribute('data-ars-grammatica-hover') === 'enabled') {
      return; // already wired up; calling again is a harmless no-op
    }
    container.setAttribute('data-ars-grammatica-hover', 'enabled');

    ensureTokenHoverStyles();

    var tooltipEl = null;
    function ensureTooltipEl() {
      if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.className = 'ag-token-tooltip';
        tooltipEl.hidden = true;
        document.body.appendChild(tooltipEl);
      }
      return tooltipEl;
    }

    function clearHighlights() {
      var highlighted = container.querySelectorAll('.ag-token-hovered, .ag-token-related');
      for (var i = 0; i < highlighted.length; i++) {
        highlighted[i].classList.remove('ag-token-hovered', 'ag-token-related');
      }
      if (tooltipEl) {
        tooltipEl.hidden = true;
      }
    }

    function findTokenElement(context, id) {
      return container.querySelector(
        '[data-context="' + cssEscapeAttrValue(context) + '"][data-id="' + cssEscapeAttrValue(id) + '"]'
      );
    }

    function relationsFor(tokenEl) {
      var context = tokenEl.getAttribute('data-context');
      var id = tokenEl.getAttribute('data-id');
      var relations = [];

      [1, 2].forEach(function (n) {
        var relatedId = tokenEl.getAttribute('data-related' + n + '-id');
        if (!relatedId) {
          return;
        }
        var targetEl = findTokenElement(context, relatedId);
        if (targetEl) {
          relations.push({
            direction: 'outgoing',
            relationship: tokenEl.getAttribute('data-relationship' + n) || '',
            other: targetEl
          });
        }
      });

      var allTokenEls = container.querySelectorAll('[data-id]');
      for (var i = 0; i < allTokenEls.length; i++) {
        var otherEl = allTokenEls[i];
        if (otherEl === tokenEl || otherEl.getAttribute('data-context') !== context) {
          continue;
        }
        [1, 2].forEach(function (n) {
          if (otherEl.getAttribute('data-related' + n + '-id') === id) {
            relations.push({
              direction: 'incoming',
              relationship: otherEl.getAttribute('data-relationship' + n) || '',
              other: otherEl
            });
          }
        });
      }

      return relations;
    }

    function formatRelationLine(tokenEl, relation) {
      var source = relation.direction === 'outgoing' ? tokenEl : relation.other;
      var target = relation.direction === 'outgoing' ? relation.other : tokenEl;
      return (
        escapeHtml(source.textContent) + ' \u2192 ' + escapeHtml(relation.relationship) +
        ' \u2192 ' + escapeHtml(target.textContent)
      );
    }

    function positionTooltip(tooltip, tokenEl) {
      var rect = tokenEl.getBoundingClientRect();
      var tipRect = tooltip.getBoundingClientRect();
      var top = rect.top - tipRect.height - 8;
      if (top < 4) {
        top = rect.bottom + 8;
      }
      var left = rect.left + rect.width / 2 - tipRect.width / 2;
      left = Math.max(4, Math.min(left, (window.innerWidth || 0) - tipRect.width - 4));
      tooltip.style.top = Math.round(top) + 'px';
      tooltip.style.left = Math.round(left) + 'px';
    }

    function activate(tokenEl) {
      clearHighlights();
      tokenEl.classList.add('ag-token-hovered');

      var relations = relationsFor(tokenEl);
      relations.forEach(function (relation) {
        relation.other.classList.add('ag-token-related');
      });

      if (onHover) {
        onHover({ tokenElement: tokenEl, relations: relations });
      }

      if (showTooltip && relations.length > 0) {
        var tooltip = ensureTooltipEl();
        tooltip.innerHTML = relations
          .map(function (relation) { return '<div>' + formatRelationLine(tokenEl, relation) + '</div>'; })
          .join('');
        tooltip.hidden = false;
        positionTooltip(tooltip, tokenEl);
      }
    }

    function deactivate() {
      clearHighlights();
      if (onUnhover) {
        onUnhover();
      }
    }

    container.addEventListener('mouseover', function (evt) {
      var tokenEl = evt.target.closest && evt.target.closest('[data-id]');
      if (!tokenEl || !container.contains(tokenEl) || tokenEl.classList.contains('ag-token-hovered')) {
        return;
      }
      activate(tokenEl);
    });

    container.addEventListener('mouseout', function (evt) {
      var tokenEl = evt.target.closest && evt.target.closest('[data-id]');
      if (!tokenEl) {
        return;
      }
      var toEl = evt.relatedTarget;
      if (toEl && tokenEl.contains(toEl)) {
        return;
      }
      deactivate();
    });

    window.addEventListener('scroll', function () {
      if (tooltipEl && !tooltipEl.hidden) {
        tooltipEl.hidden = true;
      }
    }, true);
  }

  // ---------------------------------------------------------------------

  var Syntaxer = {
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
    defaultExcludedTokenTypes: DEFAULT_EXCLUDED_TOKEN_TYPES.slice(),
    assignVerbalUnits: assignVerbalUnits,
    assignVerbalUnitColors: assignVerbalUnitColors,
    verbalUnitPalette: VERBAL_UNIT_PALETTE.map(function (c) {
      return { fill: c.fill, stroke: c.stroke, text: c.text };
    }),
    sentenceHtml: sentenceHtml,
    enableTokenHover: enableTokenHover
  };

  global.Syntaxer = Syntaxer;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Syntaxer;
  }
})(typeof window !== 'undefined' ? window : globalThis);

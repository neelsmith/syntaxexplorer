/**
 * cts-urn.js
 *
 * Small, dependency-free helpers for working with CTS URNs
 * (Canonical Text Services URNs), e.g.:
 *
 *   urn:cts:latinLit:phi0690.phi003.omar:1.1
 *
 * A CTS URN has exactly five colon-delimited components:
 *
 *   1. "urn"
 *   2. "cts"
 *   3. namespace (a text group / collection identifier)
 *   4. work component  (identifies the work, e.g. phi0690.phi003.omar)
 *   5. passage component (identifies a passage within the work, e.g. 1.1)
 *
 * This module is deliberately generic: it knows nothing about
 * arsgrammatica analyses, and can be reused in any app that needs to
 * pull apart CTS URNs.
 *
 * Loading:
 *   - In a browser, include with a plain <script src="cts-urn.js"></script>
 *     (no <script type="module">, so the file also works when an HTML
 *     page is opened directly from disk, i.e. via a file:// URL, with
 *     no web server involved). It attaches a single global, `CtsUrn`.
 *   - In Node (e.g. for tests), `require('./cts-urn.js')` returns the
 *     same object.
 */
(function (global) {
  'use strict';

  /**
   * Split a CTS URN into its colon-delimited components.
   * @param {string} urn
   * @returns {string[]}
   */
  function components(urn) {
    if (typeof urn !== 'string') {
      throw new TypeError('CtsUrn.components: expected a string, got ' + typeof urn);
    }
    return urn.split(':');
  }

  /**
   * Parse a CTS URN into its named parts.
   * @param {string} urn
   * @returns {{full: string, urnLabel: string, ctsLabel: string, namespace: string, work: string, passage: string}}
   */
  function parse(urn) {
    var parts = components(urn);
    if (parts.length !== 5) {
      throw new Error(
        'CtsUrn.parse: expected 5 colon-delimited components, found ' +
          parts.length +
          ' in "' +
          urn +
          '"'
      );
    }
    return {
      full: urn,
      urnLabel: parts[0],
      ctsLabel: parts[1],
      namespace: parts[2],
      work: parts[3],
      passage: parts[4]
    };
  }

  /**
   * The work component of a CTS URN: the fourth colon-delimited part.
   * @param {string} urn
   * @returns {string}
   */
  function workComponent(urn) {
    return parse(urn).work;
  }

  /**
   * The passage component of a CTS URN: the fifth (last) colon-delimited part.
   * @param {string} urn
   * @returns {string}
   */
  function passageComponent(urn) {
    return parse(urn).passage;
  }

  var CtsUrn = {
    components: components,
    parse: parse,
    workComponent: workComponent,
    passageComponent: passageComponent
  };

  global.CtsUrn = CtsUrn;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = CtsUrn;
  }
})(typeof window !== 'undefined' ? window : globalThis);

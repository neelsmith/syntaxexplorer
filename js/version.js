/**
 * version.js
 *
 * Single source of truth for this repository's release version
 * number. It's shared by every app under apps/ (not tied to one
 * app), and by design has nothing to do with the *format* the
 * syntactic-analysis files use (that's js/lib/syntaxer.js's concern)
 * — it's just "what release of this repo is this".
 *
 * To cut a new release:
 *   1. Update VERSION below.
 *   2. Add an entry to releases.md.
 *   3. Commit, then tag the commit on GitHub with a matching tag
 *      (e.g. "v1.0.0" for VERSION "1.0.0") and publish a release from
 *      that tag.
 *
 * Loading:
 *   - In a browser, include with a plain <script src="version.js">
 *     (no <script type="module">, so it also works when a page is
 *     opened directly from disk via a file:// URL, with no web server
 *     involved). It attaches a single global, `AppVersion`.
 *   - In Node (e.g. for tests), `require('./version.js')` returns the
 *     same object.
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';

  var AppVersion = {
    version: VERSION
  };

  global.AppVersion = AppVersion;

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = AppVersion;
  }
})(typeof window !== 'undefined' ? window : globalThis);

/**
 * app.js — Syntax Explorer
 *
 * Wires up the page in index.html to the reusable js/lib/*.js library:
 * reads a locally-selected arsgrammatica analysis file, builds a menu
 * of its sentences, and shows the "black text" view of whichever
 * sentence the user selects.
 *
 * This file is intentionally app-specific (DOM wiring only); all of
 * the file-format and text-rendering logic lives in js/lib/, so it can
 * be reused by other apps without pulling in this file.
 */
(function () {
  'use strict';

  var fileInput = document.getElementById('file-input');
  var statusEl = document.getElementById('status');
  var explorerEl = document.getElementById('explorer');
  var menuEl = document.getElementById('sentence-menu');
  var viewEl = document.getElementById('sentence-view');

  var tokens = [];
  var sentences = [];
  var tokenIndex = null;

  function setStatus(message, isError) {
    statusEl.textContent = message;
    if (isError) {
      statusEl.setAttribute('data-state', 'error');
    } else {
      statusEl.removeAttribute('data-state');
    }
  }

  fileInput.addEventListener('change', function (evt) {
    var file = evt.target.files && evt.target.files[0];
    if (!file) {
      return;
    }

    explorerEl.hidden = true;
    viewEl.textContent = '';
    setStatus('Reading ' + file.name + ' …', false);

    var reader = new FileReader();
    reader.onerror = function () {
      setStatus('Could not read "' + file.name + '": ' + reader.error, true);
    };
    reader.onload = function () {
      try {
        loadAnalysis(reader.result);
        setStatus(
          'Loaded ' + file.name + ' — ' + tokens.length + ' token(s), ' +
            sentences.length + ' sentence(s).',
          false
        );
        explorerEl.hidden = false;
      } catch (err) {
        setStatus('Error parsing "' + file.name + '": ' + err.message, true);
        console.error(err);
      }
    };
    reader.readAsText(file);
  });

  function loadAnalysis(text) {
    var parsed = ArsGrammatica.parseAnalysis(text);
    tokens = parsed.tokens;
    sentences = parsed.sentences;

    if (tokens.length === 0) {
      throw new Error('no "#!tokens" block was found (or it had no data rows)');
    }
    if (sentences.length === 0) {
      throw new Error('no "#!sentences" block was found (or it had no data rows)');
    }

    tokenIndex = ArsGrammatica.indexTokens(tokens);
    populateMenu();
  }

  function populateMenu() {
    menuEl.innerHTML = '';
    sentences.forEach(function (sentence, i) {
      var option = document.createElement('option');
      option.value = String(i);
      try {
        var slice = ArsGrammatica.tokensForSentence(tokens, sentence, tokenIndex);
        option.textContent = ArsGrammatica.sentenceLabel(slice);
      } catch (err) {
        option.textContent = '(sentence ' + (i + 1) + ': could not be read — ' + err.message + ')';
        option.disabled = true;
        console.warn(err);
      }
      menuEl.appendChild(option);
    });
    menuEl.selectedIndex = -1;
    viewEl.textContent = '';
  }

  menuEl.addEventListener('change', function () {
    if (menuEl.selectedIndex < 0) {
      viewEl.textContent = '';
      return;
    }
    var i = Number(menuEl.value);
    var sentence = sentences[i];
    try {
      var slice = ArsGrammatica.tokensForSentence(tokens, sentence, tokenIndex);
      viewEl.textContent = ArsGrammatica.sentenceText(slice);
    } catch (err) {
      viewEl.textContent = '';
      setStatus('Error displaying sentence ' + (i + 1) + ': ' + err.message, true);
      console.error(err);
    }
  });
})();

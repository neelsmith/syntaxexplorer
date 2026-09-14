/**
 * app.js — Syntax Explorer
 *
 * Wires up the page in index.html to the reusable js/lib/*.js library:
 * reads a locally-selected saved analysis file, builds a menu
 * of its sentences, shows the "black text" of whichever sentence the
 * user selects (colored by verbal unit via Syntaxer.sentenceHtml),
 * and renders that sentence's dependency relations as a pannable,
 * zoomable Mermaid graph, colored by the same verbal units. Hovering a
 * word in the text view highlights it, highlights any token(s) it's
 * related to, and shows their relationship, via
 * Syntaxer.enableTokenHover.
 *
 * This file is intentionally app-specific (DOM wiring only); all of
 * the file-format, text-rendering, and graph-building logic lives in
 * js/lib/, so it can be reused by other apps without pulling in this
 * file. Mermaid (js/vendor/mermaid/) and svg-pan-zoom
 * (js/vendor/svg-pan-zoom/) are only needed here, for actually drawing
 * and navigating the graph Syntaxer.sentenceMermaidGraph describes
 * as plain text. See notes/sentence-explorer-app.md for why both are
 * vendored rather than loaded from a CDN.
 */
(function () {
  'use strict';

  var fileInput = document.getElementById('file-input');
  var statusEl = document.getElementById('status');
  var explorerEl = document.getElementById('explorer');
  var menuEl = document.getElementById('sentence-menu');
  var viewEl = document.getElementById('sentence-view');
  var orientationEl = document.getElementById('graph-orientation');
  var graphViewEl = document.getElementById('graph-view');
  var footerEl = document.getElementById('app-footer');

  // Shown once, on load: js/version.js is the single source of truth
  // for this repo's release version (see that file for how to bump it
  // when cutting a new release).
  if (footerEl && typeof AppVersion !== 'undefined') {
    footerEl.textContent = 'Syntax Explorer v' + AppVersion.version;
  }

  var tokens = [];
  var sentences = [];
  var tokenIndex = null;
  var currentSlice = null; // token slice for the currently-selected sentence, if any
  var graphRenderCount = 0; // also doubles as a token to discard stale async renders
  var panZoomInstance = null;

  if (typeof mermaid !== 'undefined') {
    // useMaxWidth: false lets each diagram render at its own natural
    // size (however large that is) instead of being squeezed to fit
    // the container's width; svg-pan-zoom is what makes that navigable.
    mermaid.initialize({ startOnLoad: false, flowchart: { useMaxWidth: false } });
  }

  // Wired up once, on the persistent #sentence-view element: it listens
  // via event delegation, so it keeps working across every future
  // renderSentenceView() call that replaces this element's innerHTML
  // with a new sentence (see Syntaxer.enableTokenHover's own doc
  // comment in js/lib/syntaxer.js).
  Syntaxer.enableTokenHover(viewEl);

  function setStatus(message, isError) {
    statusEl.textContent = message;
    if (isError) {
      statusEl.setAttribute('data-state', 'error');
    } else {
      statusEl.removeAttribute('data-state');
    }
  }

  function clearGraph() {
    if (panZoomInstance) {
      panZoomInstance.destroy();
      panZoomInstance = null;
    }
    graphViewEl.innerHTML = '';
  }

  fileInput.addEventListener('change', function (evt) {
    var file = evt.target.files && evt.target.files[0];
    if (!file) {
      return;
    }

    explorerEl.hidden = true;
    viewEl.textContent = '';
    clearGraph();
    currentSlice = null;
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
    var parsed = Syntaxer.parseAnalysis(text);
    tokens = parsed.tokens;
    sentences = parsed.sentences;

    if (tokens.length === 0) {
      throw new Error('no "#!tokens" block was found (or it had no data rows)');
    }
    if (sentences.length === 0) {
      throw new Error('no "#!sentences" block was found (or it had no data rows)');
    }

    tokenIndex = Syntaxer.indexTokens(tokens);
    populateMenu();
  }

  function populateMenu() {
    menuEl.innerHTML = '';
    sentences.forEach(function (sentence, i) {
      var option = document.createElement('option');
      option.value = String(i);
      try {
        var slice = Syntaxer.tokensForSentence(tokens, sentence, tokenIndex);
        option.textContent = Syntaxer.sentenceLabel(slice);
      } catch (err) {
        option.textContent = '(sentence ' + (i + 1) + ': could not be read — ' + err.message + ')';
        option.disabled = true;
        console.warn(err);
      }
      menuEl.appendChild(option);
    });
    menuEl.selectedIndex = -1;
    viewEl.textContent = '';
    clearGraph();
    currentSlice = null;
  }

  menuEl.addEventListener('change', function () {
    if (menuEl.selectedIndex < 0) {
      viewEl.textContent = '';
      clearGraph();
      currentSlice = null;
      return;
    }
    var i = Number(menuEl.value);
    var sentence = sentences[i];
    try {
      var slice = Syntaxer.tokensForSentence(tokens, sentence, tokenIndex);
      renderSentenceView(slice);
      currentSlice = slice;
      renderGraph(slice);
    } catch (err) {
      viewEl.textContent = '';
      clearGraph();
      currentSlice = null;
      setStatus('Error displaying sentence ' + (i + 1) + ': ' + err.message, true);
      console.error(err);
    }
  });

  orientationEl.addEventListener('change', function () {
    if (currentSlice) {
      renderGraph(currentSlice);
    }
  });

  function renderSentenceView(slice) {
    // Colored by verbal unit, using the same clustering/palette as the
    // dependency graph below (sentenceMermaidGraph's own coloring), so
    // the same clause reads as the same color in both views.
    var textResult = Syntaxer.sentenceHtml(slice);
    viewEl.innerHTML = textResult.html;
    if (textResult.warnings.length > 0) {
      textResult.warnings.forEach(function (warning) {
        console.warn('sentenceHtml: ' + warning);
      });
    }
  }

  function renderGraph(slice) {
    if (typeof mermaid === 'undefined') {
      clearGraph();
      setStatus('Mermaid did not load, so the dependency graph cannot be drawn.', true);
      return;
    }

    var graphResult;
    try {
      graphResult = Syntaxer.sentenceMermaidGraph(slice, { orientation: orientationEl.value });
    } catch (err) {
      clearGraph();
      setStatus('Error building the graph: ' + err.message, true);
      console.error(err);
      return;
    }

    if (graphResult.warnings.length > 0) {
      graphResult.warnings.forEach(function (warning) {
        console.warn('sentenceMermaidGraph: ' + warning);
      });
    }

    var renderToken = ++graphRenderCount;
    var renderId = 'sentence-graph-' + renderToken;

    mermaid.render(renderId, graphResult.diagram).then(function (result) {
      if (renderToken !== graphRenderCount) {
        return; // a newer render (different sentence/orientation) has since started
      }
      if (panZoomInstance) {
        panZoomInstance.destroy();
        panZoomInstance = null;
      }
      graphViewEl.innerHTML = result.svg;
      attachPanZoom();
      if (graphResult.warnings.length > 0) {
        setStatus(graphResult.warnings.join(' '), false);
      }
    }, function (err) {
      if (renderToken !== graphRenderCount) {
        return;
      }
      clearGraph();
      setStatus('Error rendering the graph: ' + (err && err.message ? err.message : err), true);
      console.error(err);
    });
  }

  function attachPanZoom() {
    if (typeof svgPanZoom === 'undefined') {
      return; // graph still displays, just without pan/zoom controls
    }
    var svgEl = graphViewEl.querySelector('svg');
    if (!svgEl) {
      return;
    }
    panZoomInstance = svgPanZoom(svgEl, {
      zoomEnabled: true,
      controlIconsEnabled: true,
      fit: true,
      center: true,
      minZoom: 0.2,
      maxZoom: 25
    });
  }
})();

(function () {
  "use strict";

  const els = {
    app: document.getElementById("app"),
    controls: document.getElementById("controls"),
    viewport: document.getElementById("prompter-viewport"),
    stage: document.getElementById("prompter-stage"),
    content: document.getElementById("prompter-content"),
    scriptInput: document.getElementById("script-input"),
    fontFamily: document.getElementById("font-family"),
    fontSize: document.getElementById("font-size"),
    fontSizeValue: document.getElementById("font-size-value"),
    scrollSpeed: document.getElementById("scroll-speed"),
    speedValue: document.getElementById("speed-value"),
    flipHorizontal: document.getElementById("flip-horizontal"),
    flipVertical: document.getElementById("flip-vertical"),
    textColor: document.getElementById("text-color"),
    bgColor: document.getElementById("bg-color"),
    btnPlay: document.getElementById("btn-play"),
    btnReset: document.getElementById("btn-reset"),
    btnFullscreen: document.getElementById("btn-fullscreen"),
    btnHideControls: document.getElementById("btn-hide-controls"),
    btnShowControls: document.getElementById("btn-show-controls"),
    wikiUrl: document.getElementById("wiki-url"),
    btnLoadWiki: document.getElementById("btn-load-wiki"),
    wikiStatus: document.getElementById("wiki-status"),
  };

  const state = {
    playing: false,
    offsetY: 0,
    lastTimestamp: null,
    rafId: null,
    controlsHidden: false,
    dragStartY: null,
    dragStartOffset: 0,
  };

  const MANUAL_SCROLL_STEP = 80;

  function syncContentFromInput() {
    els.content.textContent = els.scriptInput.value;
  }

  function setScriptText(text) {
    els.scriptInput.value = text;
    syncContentFromInput();
    reset();
  }

  function setWikiStatus(message, type) {
    els.wikiStatus.textContent = message;
    els.wikiStatus.className = "wiki-status" + (type ? " " + type : "");
  }

  async function loadWikiPage() {
    const pageUrl = els.wikiUrl.value.trim();
    if (!pageUrl) {
      setWikiStatus("Paste a MediaWiki page URL first.", "error");
      return;
    }

    els.btnLoadWiki.disabled = true;
    setWikiStatus("Loading page from wiki…", "loading");

    try {
      const result = await MediaWikiLoader.loadFromUrl(pageUrl);
      setScriptText(result.text);
      setWikiStatus('Loaded "' + result.title + '".', "success");
    } catch (err) {
      let message = err.message || "Could not load that page.";
      if (message === "Failed to fetch") {
        message =
          "Could not reach the wiki (network or CORS restriction). " +
          "Private wikis use api/fetch-wiki.php on this server.";
      }
      setWikiStatus(message, "error");
    } finally {
      els.btnLoadWiki.disabled = false;
    }
  }

  function applyFontFamily() {
    els.content.style.fontFamily = els.fontFamily.value;
  }

  function applyFontSize() {
    const size = els.fontSize.value;
    els.fontSizeValue.textContent = size;
    els.content.style.fontSize = size + "px";
  }

  function applyColors() {
    els.content.style.color = els.textColor.value;
    els.viewport.style.background = els.bgColor.value;
    document.documentElement.style.setProperty("--viewport-bg", els.bgColor.value);
  }

  function applyFlip() {
    const scaleX = els.flipHorizontal.checked ? -1 : 1;
    const scaleY = els.flipVertical.checked ? -1 : 1;
    els.stage.style.transform = "scale(" + scaleX + ", " + scaleY + ")";
  }

  function getSpeedPxPerSec() {
    return Number(els.scrollSpeed.value);
  }

  function updateSpeedLabel() {
    els.speedValue.textContent = els.scrollSpeed.value;
  }

  function getMaxScroll() {
    const viewportHeight = els.viewport.clientHeight;
    const contentHeight = els.content.offsetHeight;
    return Math.max(0, contentHeight - viewportHeight * 0.2);
  }

  function applyTransform() {
    els.content.style.transform = "translateY(-" + state.offsetY + "px)";
  }

  function setOffsetY(y) {
    state.offsetY = Math.max(0, Math.min(y, getMaxScroll()));
    applyTransform();
  }

  function nudgeScroll(deltaY) {
    setOffsetY(state.offsetY + deltaY);
    if (state.playing) {
      state.lastTimestamp = null;
    }
  }

  function bindManualScroll() {
    els.viewport.addEventListener(
      "wheel",
      function (e) {
        e.preventDefault();
        nudgeScroll(e.deltaY);
      },
      { passive: false }
    );

    els.viewport.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) {
        return;
      }
      state.dragStartY = e.clientY;
      state.dragStartOffset = state.offsetY;
      els.viewport.classList.add("is-dragging");
      if (els.viewport.setPointerCapture) {
        els.viewport.setPointerCapture(e.pointerId);
      }
    });

    els.viewport.addEventListener("pointermove", function (e) {
      if (state.dragStartY === null) {
        return;
      }
      const delta = state.dragStartY - e.clientY;
      setOffsetY(state.dragStartOffset + delta);
      if (state.playing) {
        state.lastTimestamp = null;
      }
    });

    function endDrag(e) {
      if (state.dragStartY === null) {
        return;
      }
      state.dragStartY = null;
      els.viewport.classList.remove("is-dragging");
      if (els.viewport.releasePointerCapture) {
        els.viewport.releasePointerCapture(e.pointerId);
      }
    }

    els.viewport.addEventListener("pointerup", endDrag);
    els.viewport.addEventListener("pointercancel", endDrag);
  }

  function resetScroll() {
    state.offsetY = 0;
    applyTransform();
  }

  function tick(timestamp) {
    if (!state.playing) return;

    if (state.lastTimestamp === null) {
      state.lastTimestamp = timestamp;
    }

    const deltaSec = (timestamp - state.lastTimestamp) / 1000;
    state.lastTimestamp = timestamp;

    const maxScroll = getMaxScroll();
    if (state.offsetY >= maxScroll) {
      pause();
      return;
    }

    setOffsetY(state.offsetY + getSpeedPxPerSec() * deltaSec);
    state.rafId = requestAnimationFrame(tick);
  }

  function play() {
    if (state.playing) return;
    state.playing = true;
    state.lastTimestamp = null;
    updatePlayButton();
    state.rafId = requestAnimationFrame(tick);
  }

  function pause() {
    state.playing = false;
    state.lastTimestamp = null;
    if (state.rafId !== null) {
      cancelAnimationFrame(state.rafId);
      state.rafId = null;
    }
    updatePlayButton();
  }

  function togglePlay() {
    if (state.playing) {
      pause();
    } else {
      play();
    }
  }

  function updatePlayButton() {
    if (state.playing) {
      els.btnPlay.innerHTML = '<i class="bi bi-pause-fill"></i> Pause';
      els.btnPlay.classList.remove("btn-success");
      els.btnPlay.classList.add("btn-warning");
    } else {
      els.btnPlay.innerHTML = '<i class="bi bi-play-fill"></i> Play';
      els.btnPlay.classList.remove("btn-warning");
      els.btnPlay.classList.add("btn-success");
    }
  }

  function reset() {
    pause();
    resetScroll();
  }

  function toggleControlsHidden() {
    state.controlsHidden = !state.controlsHidden;
    els.controls.classList.toggle("hidden", state.controlsHidden);
    els.btnShowControls.classList.toggle("d-none", !state.controlsHidden);
    els.btnShowControls.classList.toggle("visible", state.controlsHidden);
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      els.app.requestFullscreen().catch(function () {});
    } else {
      document.exitFullscreen();
    }
  }

  function updateFullscreenIcon() {
    const icon = document.fullscreenElement
      ? "bi-fullscreen-exit"
      : "bi-fullscreen";
    els.btnFullscreen.innerHTML = '<i class="bi ' + icon + '"></i>';
  }

  function bindEvents() {
    els.scriptInput.addEventListener("input", function () {
      syncContentFromInput();
      if (state.offsetY > getMaxScroll()) {
        setOffsetY(getMaxScroll());
      }
    });

    els.fontFamily.addEventListener("change", applyFontFamily);
    els.fontSize.addEventListener("input", applyFontSize);
    els.scrollSpeed.addEventListener("input", updateSpeedLabel);
    els.flipHorizontal.addEventListener("change", applyFlip);
    els.flipVertical.addEventListener("change", applyFlip);
    els.textColor.addEventListener("input", applyColors);
    els.bgColor.addEventListener("input", applyColors);

    els.btnPlay.addEventListener("click", togglePlay);
    els.btnReset.addEventListener("click", reset);
    els.btnFullscreen.addEventListener("click", toggleFullscreen);
    els.btnHideControls.addEventListener("click", toggleControlsHidden);
    els.btnShowControls.addEventListener("click", toggleControlsHidden);
    els.btnLoadWiki.addEventListener("click", loadWikiPage);
    els.wikiUrl.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        loadWikiPage();
      }
    });

    document.addEventListener("fullscreenchange", updateFullscreenIcon);

    window.addEventListener("resize", function () {
      if (state.offsetY > getMaxScroll()) {
        setOffsetY(getMaxScroll());
      }
    });

    document.addEventListener("keydown", function (e) {
      if (e.target === els.scriptInput) return;

      switch (e.code) {
        case "Space":
          e.preventDefault();
          togglePlay();
          break;
        case "Home":
          e.preventDefault();
          reset();
          break;
        case "PageUp":
          e.preventDefault();
          nudgeScroll(-MANUAL_SCROLL_STEP * 3);
          break;
        case "PageDown":
          e.preventDefault();
          nudgeScroll(MANUAL_SCROLL_STEP * 3);
          break;
        case "ArrowUp":
          if (e.shiftKey) {
            e.preventDefault();
            nudgeScroll(-MANUAL_SCROLL_STEP);
            break;
          }
          e.preventDefault();
          els.scrollSpeed.value = Math.min(200, Number(els.scrollSpeed.value) + 5);
          updateSpeedLabel();
          break;
        case "ArrowDown":
          if (e.shiftKey) {
            e.preventDefault();
            nudgeScroll(MANUAL_SCROLL_STEP);
            break;
          }
          e.preventDefault();
          els.scrollSpeed.value = Math.max(10, Number(els.scrollSpeed.value) - 5);
          updateSpeedLabel();
          break;
        case "Escape":
          if (state.controlsHidden) toggleControlsHidden();
          break;
      }
    });
  }

  function initFromQueryString() {
    const params = new URLSearchParams(window.location.search);
    const wikiParam = params.get("wiki");
    if (wikiParam) {
      els.wikiUrl.value = wikiParam;
      loadWikiPage();
    }
  }

  function init() {
    syncContentFromInput();
    applyFontFamily();
    applyFontSize();
    applyColors();
    applyFlip();
    updateSpeedLabel();
    bindEvents();
    bindManualScroll();
    initFromQueryString();
  }

  init();
})();

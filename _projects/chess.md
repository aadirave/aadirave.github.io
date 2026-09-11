---
layout: page
title: chess
permalink: /chess/
description: play against my chess engine!
nav: false
category: work
importance: 1
---

<!--
  Styles are inline on purpose. The starter may not own `_sass/` (the style
  contract fails CI if it does), and PurgeCSS rewrites only `_site/assets/css/*.css`
  during deploy -- so a page-scoped style element is both the allowed home for
  this CSS and the one place a script-applied class cannot be purged out from
  under the board.

  Two things must never appear inside an HTML comment on this page, both of
  which have already broken it once:

  1. A literal start tag for style, script, pre or textarea. jekyll-minifier
     runs on production builds only and preserves those elements by regex
     before it strips comments, so a tag named in prose gets paired with the
     real closing tag below. Comment removal then ran from the comment naming
     it all the way to the end of the next comment, deleting the stylesheet,
     the board's mount point and the credit line. The deployed page rendered
     its title and engine stamp with no board between them.

  2. A literal comment-closing delimiter, even in quotes. It ends the comment
     early and everything after it renders as visible page text.

  Name the tags in prose, as above, and neither happens.
-->

<style>
  .chess-app {
    display: flex;
    flex-wrap: wrap;
    gap: 1.5rem;
    align-items: flex-start;
    margin: 1.5rem 0;
  }

  .chess-board {
    display: grid;
    grid-template-columns: repeat(8, 1fr);
    grid-template-rows: repeat(8, 1fr);
    width: min(92vw, 40rem);
    aspect-ratio: 1;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 2px 10px rgb(0 0 0 / 20%);
  }

  /* The engine never came up (or a request round-trip failed hard enough to
     leave it unusable): dim the board rather than leaving it looking merely
     unresponsive, and block input to it -- New Game still lives in the panel. */
  .chess-board.is-unavailable {
    opacity: 0.5;
    pointer-events: none;
  }

  .chess-square {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    min-width: 0;
    min-height: 0;
    padding: 0;
    border: 0;
    cursor: pointer;
    background-repeat: no-repeat;
    background-position: center;
    touch-action: pan-x pan-y; /* a plain tap or scroll must reach the page by default */
  }

  /* Only once a drag is confirmed (past the pick-up threshold) does it block
     native panning -- doing this unconditionally on every square would trap
     any swipe that starts on the board, confirmed drag or not. */
  .chess-board.is-drag-active .chess-square {
    touch-action: none;
  }

  .chess-piece {
    width: 88%;
    height: 88%;
    pointer-events: none;
    user-select: none;
  }

  .chess-square.is-dragging .chess-piece {
    visibility: hidden;
  }

  .chess-drag-ghost {
    position: fixed;
    top: 0;
    left: 0;
    z-index: 10;
    pointer-events: none;
    filter: drop-shadow(0 3px 5px rgb(0 0 0 / 40%));
  }

  .chess-square[data-shade="light"] {
    background-color: #ebecd0;
  }

  .chess-square[data-shade="dark"] {
    background-color: #779556;
  }

  .chess-square:focus-visible {
    outline: 3px solid var(--global-theme-color);
    outline-offset: -3px;
    z-index: 1;
  }

  /* Tints and rings: ::before overlays, so the square keeps its own colour. */
  .chess-square::before {
    content: "";
    position: absolute;
    inset: 0;
    pointer-events: none;
  }

  .chess-square.is-last-move::before {
    background: rgb(255 235 59 / 32%);
  }

  .chess-square.is-selected::before {
    background: rgb(255 235 59 / 55%);
  }

  .chess-square.is-capture::before {
    box-shadow: inset 0 0 0 4px rgb(0 0 0 / 35%);
  }

  /* Move hints are a background image so ::after stays free for coordinates. */
  .chess-square.is-target {
    background-image: radial-gradient(circle, rgb(0 0 0 / 28%) 21%, transparent 22%);
  }

  .chess-square[data-file]::after,
  .chess-square[data-rank]::after {
    position: absolute;
    font-size: 0.72rem;
    font-weight: 600;
    line-height: 1;
    text-shadow: none;
  }

  .chess-square[data-shade="light"]::after {
    color: #6b7a4e;
  }

  .chess-square[data-shade="dark"]::after {
    color: #ebecd0;
  }

  .chess-square[data-file]::after {
    content: attr(data-file);
    right: 4px;
    bottom: 3px;
  }

  .chess-square[data-rank]::after {
    content: attr(data-rank);
    left: 4px;
    top: 3px;
  }

  .chess-panel {
    flex: 1 1 12rem;
    min-width: 12rem;
  }

  .chess-status {
    font-weight: 600;
    margin-bottom: 0.75rem;
  }

  .chess-controls {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
  }

  .chess-button {
    padding: 0.35rem 0.8rem;
    border: 1px solid var(--global-divider-color);
    border-radius: 4px;
    background: var(--global-card-bg-color);
    color: var(--global-text-color);
    font-size: 1rem;
    cursor: pointer;
  }

  .chess-button:hover {
    border-color: var(--global-theme-color);
    color: var(--global-theme-color);
  }

  .chess-toggle {
    display: flex;
    gap: 0.35rem;
    align-items: center;
    margin: 0;
    font-size: 0.9rem;
    color: var(--global-text-color-light);
  }

  .chess-select {
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--global-divider-color);
    border-radius: 4px;
    background: var(--global-card-bg-color);
    color: var(--global-text-color);
    font-size: 0.9rem;
    cursor: pointer;
  }

  .chess-credit {
    font-size: 0.8rem;
    color: var(--global-text-color-light);
  }

  .chess-promotion {
    display: flex;
    gap: 0.4rem;
    margin-top: 0.9rem;
  }

  .chess-promotion-choice {
    display: flex;
    width: 2.6rem;
    height: 2.6rem;
    padding: 0.15rem;
  }
</style>

<div id="chess-app" class="chess-app">
  <noscript>This board needs JavaScript to run.</noscript>
</div>

<p class="chess-credit">
  Piece graphics by <a href="https://en.wikipedia.org/wiki/User:Cburnett">Cburnett</a>, licensed
  <a href="https://creativecommons.org/licenses/by-sa/3.0/">CC BY-SA 3.0</a>.
</p>
<!--
  site.data.chess.engine_version mirrors assets/chess/VERSION -- Liquid's include/
  include_relative tags can't read a file outside _includes/ or reached via "..",
  so the vendored engine's commit SHA is duplicated into _data/chess.yml instead
  of read from the artifact stamp directly. Keep it in sync when re-vendoring.
-->
<p class="chess-credit">engine @ {{ site.data.chess.engine_version }}</p>

<script type="module">
  import { mountChessBoard } from "{{ '/assets/js/chess/ui.js' | relative_url }}";

  // The Worker is a static file and gets no Liquid pass, so it cannot resolve
  // site paths itself -- the engine URL is resolved here and handed over as data.
  //
  // chess_engine.min.js is NOT minified -- it's vendored byte-for-byte from the
  // engine repo. jekyll-terser has no config-driven exclude, only a hardcoded
  // skip for paths ending ".min.js", so this suffix is the only way to stop it
  // re-minifying the glue and shipping a derivative of what the engine repo's
  // equivalence gates (W-1/W-2/W-3) actually ran against. Don't "fix" the name.
  mountChessBoard(document.getElementById("chess-app"), {
    workerUrl: "{{ '/assets/js/chess/worker.js' | relative_url }}",
    engineUrl: "{{ '/assets/chess/chess_engine.min.js' | relative_url }}",
    pieceBaseUrl: "{{ '/assets/img/chess/' | relative_url }}",
  });
</script>

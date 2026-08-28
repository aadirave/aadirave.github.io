---
layout: page
title: chess
permalink: /chess/
description: Play against my chess engine in the browser.
nav: false
---

The engine is a C++ program I wrote; the plan is to compile it to WebAssembly and run it here, entirely in your browser. **It is not wired up yet** — the
board below talks to a placeholder that accepts any move and knows none of the rules, so nothing here is legal chess. It exists to prove the page, the
asset loading, and the message protocol work before the real engine arrives.

<!--
  Styles are inline on purpose. The starter may not own `_sass/` (the style
  contract fails CI if it does), and PurgeCSS rewrites only `_site/assets/css/*.css`
  during deploy -- so a page-scoped <style> block is both the allowed home for
  this CSS and the one place a script-applied class cannot be purged out from
  under the board.
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
    width: min(88vw, 30rem);
    aspect-ratio: 1;
    border-radius: 4px;
    overflow: hidden;
    box-shadow: 0 2px 10px rgb(0 0 0 / 20%);
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
    touch-action: none; /* a drag across the board must not scroll the page */
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
    font-size: 0.62rem;
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

<script type="module">
  import { mountChessBoard } from "{{ '/assets/js/chess/ui.js' | relative_url }}";

  // The Worker is a static file and gets no Liquid pass, so it cannot resolve
  // site paths itself -- the engine URL is resolved here and handed over as data.
  mountChessBoard(document.getElementById("chess-app"), {
    workerUrl: "{{ '/assets/js/chess/worker.js' | relative_url }}",
    engineUrl: "{{ '/assets/chess/chess_engine.js' | relative_url }}",
    pieceBaseUrl: "{{ '/assets/img/chess/' | relative_url }}",
  });
</script>

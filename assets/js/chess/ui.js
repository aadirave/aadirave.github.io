/**
 * Dependency-free chess board: 8x8 grid, SVG pieces, click-to-move or drag.
 *
 * The board knows no rules. Every legal destination it offers comes from the
 * engine's own move list, and every move it plays is one the engine accepted,
 * so there is exactly one authority on chess here and it is not this file.
 */

import { REQ, RES, STATUS } from "./protocol.js";
import { colorOf, indexToSquare, parseFen, parseUci, squareToIndex } from "./fen.js";

const PIECE_NAMES = { k: "king", q: "queen", r: "rook", b: "bishop", n: "knight", p: "pawn" };
const PROMOTION_ORDER = ["q", "r", "b", "n"];
const DRAG_THRESHOLD_PX = 5;
// Sized from gate W5: the wasm build runs at ~0.96x native, ~1.9M nps, so this
// budget buys roughly a million nodes -- a real search, and still fast enough
// that the reply lands before the board feels stalled. Depth is pinned to the
// engine's own MAX_SEARCH_PLY so the clock, not the depth, is what stops it.
const MOVETIME_MS = 500;
const MAX_DEPTH = 64;

/** Promise-per-request wrapper over the engine Worker. */
class EngineClient {
  constructor(workerUrl) {
    this.worker = new Worker(workerUrl, { type: "module" });
    this.pending = new Map();
    this.nextId = 1;
    this.onInfo = () => {};
    this.worker.addEventListener("message", (event) => this.receive(event.data));
    this.worker.addEventListener("error", (event) => this.failAll(event.message || "engine worker failed to load"));
  }

  receive(message) {
    if (message.type === RES.INFO) {
      this.onInfo(message);
      return;
    }
    const settle = this.pending.get(message.id);
    if (!settle) return;
    this.pending.delete(message.id);
    if (message.type === RES.ERROR) settle.reject(new Error(message.message));
    else settle.resolve(message.value ?? null);
  }

  failAll(reason) {
    this.pending.forEach((settle) => settle.reject(new Error(reason)));
    this.pending.clear();
  }

  request(type, payload = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...payload, type, id });
    });
  }
}

class ChessBoard {
  constructor(root, options) {
    this.root = root;
    this.engineUrl = options.engineUrl;
    this.pieceBaseUrl = options.pieceBaseUrl;
    this.workerUrl = options.workerUrl;
    this.squares = new Map();
    // The side the human plays: it picks the board's orientation and, by
    // elimination, the side the engine answers as. Set before buildDom(),
    // which lays the squares out from it.
    this.playerColor = "w";
    this.position = null;
    this.legalMoves = [];
    this.selected = null;
    this.lastMove = null;
    this.drag = null;
    this.suppressClick = false;
    this.busy = true;
    // Explicit "the engine has never come up" state -- separate from `busy`,
    // which is transient, so a failed init can't be confused with a move in
    // flight and New Game knows to retry the init sequence rather than play.
    this.ready = false;
    // Bumped on every new-game and every move; a response is discarded once
    // this has moved on, so a slow reply from a superseded game/move can
    // never overwrite fresher state (see start/play/engineReply/onNewGame).
    this.generation = 0;
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.onPointerCancel = this.onPointerCancel.bind(this);
    this.buildDom();
  }

  async start() {
    const gen = ++this.generation;
    // A fresh Worker, not just a fresh INIT request: if the previous one
    // failed to load at all, it will never answer another postMessage.
    this.engine?.worker.terminate();
    this.engine = new EngineClient(this.workerUrl);
    this.busy = true;
    this.setStatus("Loading…");
    try {
      await this.engine.request(REQ.INIT, { engineUrl: this.engineUrl });
      if (gen !== this.generation) return;
      this.ready = true;
      this.boardEl.classList.remove("is-unavailable");
      await this.refresh(gen);
      if (gen !== this.generation) return;
      if (this.shouldEngineMove()) await this.engineReply(gen);
    } catch (error) {
      if (gen !== this.generation) return;
      this.ready = false;
      this.boardEl.classList.add("is-unavailable");
      this.setStatus(`Engine unavailable: ${error.message} — click New Game to retry.`);
    } finally {
      if (gen === this.generation) this.busy = false;
    }
  }

  pieceUrl(piece) {
    return `${this.pieceBaseUrl}${colorOf(piece)}${piece.toLowerCase()}.svg`;
  }

  buildDom() {
    const board = document.createElement("div");
    board.className = "chess-board";

    for (let index = 0; index < 64; index += 1) {
      const square = indexToSquare(index);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chess-square";
      button.dataset.square = square;
      // Shade follows the square itself, not its position in the DOM, so
      // flipping the board never repaints a1 as a light square.
      button.dataset.shade = (Math.floor(index / 8) + (index % 8)) % 2 === 0 ? "light" : "dark";

      // One <img> per square, reused across renders so dragging a piece never
      // races a freshly created element.
      const image = document.createElement("img");
      image.className = "chess-piece";
      image.alt = "";
      image.draggable = false;
      image.hidden = true;
      button.appendChild(image);

      button.addEventListener("click", () => this.onSquareClick(square));
      button.addEventListener("pointerdown", (event) => this.onPointerDown(event, square));
      board.appendChild(button);
      this.squares.set(square, button);
    }

    const status = document.createElement("p");
    status.className = "chess-status";
    status.setAttribute("role", "status");
    status.textContent = "Loading…";

    const newGame = document.createElement("button");
    newGame.type = "button";
    newGame.className = "chess-button";
    newGame.textContent = "New game";
    newGame.addEventListener("click", () => this.onNewGame());

    const replyToggle = document.createElement("input");
    replyToggle.type = "checkbox";
    replyToggle.id = "chess-auto-reply";
    // On by default now that the backend is the real engine: playing against it
    // is the point of the page. It stayed off through Phase 1 only because the
    // mock replied with arbitrary moves.
    replyToggle.checked = true;
    const replyLabel = document.createElement("label");
    replyLabel.className = "chess-toggle";
    replyLabel.htmlFor = replyToggle.id;
    replyLabel.append(replyToggle, document.createTextNode(" Engine replies"));

    const sideSelect = document.createElement("select");
    sideSelect.id = "chess-side";
    sideSelect.className = "chess-select";
    for (const [value, text] of [
      ["w", "White"],
      ["b", "Black"],
    ]) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      sideSelect.appendChild(option);
    }
    sideSelect.value = this.playerColor;
    sideSelect.addEventListener("change", () => this.onSideChange(sideSelect.value));
    const sideLabel = document.createElement("label");
    sideLabel.className = "chess-toggle";
    sideLabel.htmlFor = sideSelect.id;
    sideLabel.append(document.createTextNode("Play as "), sideSelect);

    const promotion = document.createElement("div");
    promotion.className = "chess-promotion";
    promotion.hidden = true;

    const controls = document.createElement("div");
    controls.className = "chess-controls";
    controls.append(newGame, sideLabel, replyLabel);

    const panel = document.createElement("div");
    panel.className = "chess-panel";
    panel.append(status, controls, promotion);

    this.root.replaceChildren(board, panel);
    this.boardEl = board;
    this.statusEl = status;
    this.promotionEl = promotion;
    this.replyToggle = replyToggle;
    this.sideSelect = sideSelect;
    this.applyOrientation();
  }

  /** The side the engine answers as -- always the one the human isn't playing. */
  get engineColor() {
    return this.playerColor === "w" ? "b" : "w";
  }

  /**
   * Lays the 64 buttons out from the player's side of the board and re-labels
   * the edges, since which rank is nearest and which file is leftmost both
   * change with orientation. The squares Map is built in a8..h1 order, so
   * black's view is exactly that reversed.
   *
   * Reordering the DOM rather than rotating it with a transform keeps the
   * pieces, the coordinate labels and the drag ghost upright without each
   * needing a counter-rotation.
   */
  applyOrientation() {
    const order = [...this.squares.keys()];
    if (this.playerColor === "b") order.reverse();
    order.forEach((square, position) => {
      const button = this.squares.get(square);
      delete button.dataset.file;
      delete button.dataset.rank;
      if (position >= 56) button.dataset.file = square[0];
      if (position % 8 === 0) button.dataset.rank = square[1];
      this.boardEl.appendChild(button);
    });
  }

  /**
   * Whether it is the engine's turn to answer. An empty move list means the
   * game is over, so this also stops a search being started on a finished
   * position.
   */
  shouldEngineMove() {
    return Boolean(this.replyToggle.checked && this.position && this.position.turn === this.engineColor && this.legalMoves.length > 0);
  }

  async onSideChange(color) {
    if (color === this.playerColor) return;
    this.playerColor = color;
    this.applyOrientation();
    // Both belonged to the orientation being left behind.
    this.select(null);
    this.hidePromotion();
    // Switching sides mid-game hands the side just vacated to the engine
    // rather than resetting -- New Game is right there for a fresh start.
    // A move already in flight will finish and is left to run its course.
    if (!this.ready || this.busy || !this.shouldEngineMove()) return;
    const gen = ++this.generation;
    this.busy = true;
    try {
      await this.engineReply(gen);
    } catch (error) {
      if (gen === this.generation) this.setStatus(`Engine error: ${error.message}`);
    } finally {
      if (gen === this.generation) this.busy = false;
    }
  }

  setStatus(text) {
    this.statusEl.textContent = text;
  }

  async refresh(gen) {
    // A stale picker can't refer to the position we're about to show, whoever
    // ends up winning the race below.
    this.hidePromotion();
    const [fen, moves, status] = await Promise.all([
      this.engine.request(REQ.FEN),
      this.engine.request(REQ.LEGAL_MOVES),
      this.engine.request(REQ.STATUS),
    ]);
    // Superseded by a newer game or move while these requests were in
    // flight -- applying this response now would show a stale position.
    if (gen !== this.generation) return;
    this.position = parseFen(fen);
    this.legalMoves = moves.split(" ").filter(Boolean);
    this.selected = null;
    this.render();
    this.setStatus(this.describe(status));
  }

  describe(status) {
    // The side to move is the mated side, so one name covers both cases.
    const mover = this.position.turn === "w" ? "White" : "Black";
    switch (status) {
      case STATUS.CHECKMATE:
        return `Checkmate — ${mover} is mated.`;
      case STATUS.STALEMATE:
        return "Stalemate — draw.";
      case STATUS.DRAW_REPETITION:
        return "Draw by threefold repetition.";
      case STATUS.DRAW_FIFTY_MOVE:
        return "Draw by the fifty-move rule.";
      case STATUS.DRAW_INSUFFICIENT_MATERIAL:
        return "Draw — insufficient material.";
      default:
        return `${mover} to move.`;
    }
  }

  /** Moves playable from `square`, as returned by the engine. */
  movesFrom(square) {
    return this.legalMoves.filter((move) => move.startsWith(square));
  }

  pieceAt(square) {
    return this.position ? this.position.pieces[squareToIndex(square)] : null;
  }

  canPickUp(square) {
    const piece = this.pieceAt(square);
    return Boolean(piece) && colorOf(piece) === this.position.turn && this.movesFrom(square).length > 0;
  }

  render() {
    const targets = this.selected ? new Set(this.movesFrom(this.selected).map((move) => parseUci(move).to)) : new Set();

    this.squares.forEach((button, square) => {
      const piece = this.pieceAt(square);
      const image = button.firstElementChild;
      if (piece) {
        const url = this.pieceUrl(piece);
        if (image.getAttribute("src") !== url) image.setAttribute("src", url);
        image.hidden = false;
      } else {
        image.hidden = true;
      }

      button.dataset.color = piece ? colorOf(piece) : "";
      button.setAttribute(
        "aria-label",
        piece ? `${square}, ${colorOf(piece) === "w" ? "white" : "black"} ${PIECE_NAMES[piece.toLowerCase()]}` : `${square}, empty`
      );

      button.classList.toggle("is-selected", square === this.selected);
      button.classList.toggle("is-target", targets.has(square) && !piece);
      button.classList.toggle("is-capture", targets.has(square) && Boolean(piece));
      button.classList.toggle("is-last-move", this.lastMove ? square === this.lastMove.from || square === this.lastMove.to : false);
      button.classList.toggle("is-dragging", Boolean(this.drag?.active) && square === this.drag.from);
    });
  }

  // --- interaction -----------------------------------------------------------

  onSquareClick(square) {
    // A completed drag also produces a click; it must not undo the drop.
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    if (this.busy || !this.position) return;
    this.hidePromotion();

    if (this.selected && this.selected !== square) {
      this.attemptMove(this.selected, square);
      return;
    }
    this.select(this.canPickUp(square) && square !== this.selected ? square : null);
  }

  select(square) {
    this.selected = square;
    this.render();
  }

  attemptMove(from, to) {
    const candidates = this.movesFrom(from).filter((move) => parseUci(move).to === to);
    if (candidates.length > 1) {
      this.select(from);
      this.showPromotion(candidates);
      return;
    }
    if (candidates.length === 1) {
      this.play(candidates[0]);
      return;
    }
    // Not a move the engine offers: keep the piece in hand rather than
    // silently dropping the selection.
    this.select(this.canPickUp(to) ? to : from);
  }

  onPointerDown(event, square) {
    // A fresh gesture always resolves the last one's leftovers: a completed
    // drag only ever gets a matching click when it lands back on its own
    // square (see onPointerUp), so a cross-square drop would otherwise leave
    // suppressClick stuck and eat this square's own, unrelated click.
    this.suppressClick = false;
    this.hidePromotion();
    if (this.drag || this.busy || !this.position || event.button !== 0 || !this.canPickUp(square)) return;
    this.drag = { from: square, startX: event.clientX, startY: event.clientY, active: false, pointerId: event.pointerId };
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
    window.addEventListener("pointercancel", this.onPointerCancel);
  }

  onPointerMove(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    if (!this.drag.active) {
      if (Math.hypot(event.clientX - this.drag.startX, event.clientY - this.drag.startY) < DRAG_THRESHOLD_PX) return;
      this.beginDrag();
    }
    this.moveGhost(event.clientX, event.clientY);
  }

  beginDrag() {
    const source = this.squares.get(this.drag.from);
    const rect = source.getBoundingClientRect();
    const ghost = document.createElement("img");
    ghost.className = "chess-drag-ghost";
    ghost.src = this.pieceUrl(this.pieceAt(this.drag.from));
    ghost.alt = "";
    ghost.style.width = `${rect.width}px`;
    ghost.style.height = `${rect.height}px`;
    document.body.appendChild(ghost);

    this.drag.active = true;
    this.drag.ghost = ghost;
    this.selected = this.drag.from;
    // Only a confirmed drag blocks native panning -- a plain tap must still
    // be able to scroll the page (or, mid-tap, do nothing at all).
    this.boardEl.classList.add("is-drag-active");
    this.render();
  }

  moveGhost(x, y) {
    const ghost = this.drag.ghost;
    ghost.style.transform = `translate(${x - ghost.offsetWidth / 2}px, ${y - ghost.offsetHeight / 2}px)`;
  }

  /**
   * Shared teardown for a drag that ended, whether by drop or by
   * pointercancel: listeners, the ghost, the drag state, and the scroll lock
   * all have to go together or one of them leaks.
   */
  endDrag() {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    window.removeEventListener("pointercancel", this.onPointerCancel);
    const drag = this.drag;
    this.drag = null;
    if (drag?.active) {
      drag.ghost.remove();
      this.boardEl.classList.remove("is-drag-active");
      this.render();
    }
    return drag;
  }

  onPointerUp(event) {
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    const drag = this.endDrag();
    if (!drag.active) return;

    const dropped = document.elementFromPoint(event.clientX, event.clientY)?.closest(".chess-square");
    if (dropped && dropped.dataset.square !== drag.from) {
      // Dropping on a different square means pointerdown and pointerup hit
      // different elements, so no click follows to consume this flag here --
      // it only guards against a synthetic click some browsers still fire on
      // the drop square. A drop back on the origin square gets a real click
      // (down and up share a target) and must not have it swallowed.
      this.suppressClick = true;
      this.attemptMove(drag.from, dropped.dataset.square);
    }
  }

  onPointerCancel(event) {
    // OS-level interruption (an incoming call, a system gesture): tear down
    // and leave the position exactly as it was, playing no move.
    if (!this.drag || event.pointerId !== this.drag.pointerId) return;
    this.endDrag();
  }

  // --- moves -----------------------------------------------------------------

  showPromotion(candidates) {
    const byPiece = new Map(candidates.map((move) => [parseUci(move).promotion, move]));
    const buttons = PROMOTION_ORDER.filter((piece) => byPiece.has(piece)).map((piece) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "chess-button chess-promotion-choice";
      button.setAttribute("aria-label", `Promote to ${PIECE_NAMES[piece]}`);

      const image = document.createElement("img");
      image.className = "chess-piece";
      image.alt = "";
      image.src = this.pieceUrl(this.position.turn === "w" ? piece.toUpperCase() : piece);
      button.appendChild(image);

      button.addEventListener("click", () => {
        this.hidePromotion();
        this.play(byPiece.get(piece));
      });
      return button;
    });
    this.promotionEl.replaceChildren(...buttons);
    this.promotionEl.hidden = false;
  }

  hidePromotion() {
    this.promotionEl.hidden = true;
    this.promotionEl.replaceChildren();
  }

  async play(move) {
    const gen = ++this.generation;
    this.busy = true;
    try {
      const accepted = await this.engine.request(REQ.PUSH, { move });
      // A new game (or, in principle, another move) has already superseded
      // this one -- whatever it did to the board and the status stands.
      if (gen !== this.generation) return;
      if (!accepted) {
        this.setStatus("The engine rejected that move.");
        return;
      }
      this.lastMove = parseUci(move);
      await this.refresh(gen);
      if (gen !== this.generation) return;
      if (this.shouldEngineMove()) await this.engineReply(gen);
    } catch (error) {
      if (gen === this.generation) this.setStatus(`Engine error: ${error.message}`);
    } finally {
      if (gen === this.generation) this.busy = false;
    }
  }

  async engineReply(gen) {
    this.setStatus("Thinking…");
    const best = await this.engine.request(REQ.SEARCH, { movetimeMs: MOVETIME_MS, maxDepth: MAX_DEPTH });
    if (gen !== this.generation) return;
    if (!best) return;
    // Mirror play()'s own rejection path: the engine's move is not exempt
    // from being an authority-checked move just because it made it itself.
    const accepted = await this.engine.request(REQ.PUSH, { move: best });
    if (gen !== this.generation) return;
    if (!accepted) {
      this.setStatus("The engine's own reply was rejected.");
      return;
    }
    this.lastMove = parseUci(best);
    await this.refresh(gen);
  }

  async onNewGame() {
    if (!this.ready) {
      // The engine never came up; New Game doubles as the retry action
      // rather than adding a second control for the same recovery.
      await this.start();
      return;
    }
    const gen = ++this.generation;
    this.busy = true;
    try {
      await this.engine.request(REQ.NEW_GAME);
      if (gen !== this.generation) return;
      this.lastMove = null;
      this.hidePromotion();
      await this.refresh(gen);
      if (gen !== this.generation) return;
      if (this.shouldEngineMove()) await this.engineReply(gen);
    } catch (error) {
      if (gen === this.generation) this.setStatus(`Engine error: ${error.message}`);
    } finally {
      if (gen === this.generation) this.busy = false;
    }
  }
}

export function mountChessBoard(root, options) {
  const board = new ChessBoard(root, options);
  board.start();
  return board;
}

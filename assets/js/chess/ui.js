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
const MOVETIME_MS = 300;
const MAX_DEPTH = 8;

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
    this.engine = new EngineClient(options.workerUrl);
    this.squares = new Map();
    this.position = null;
    this.legalMoves = [];
    this.selected = null;
    this.lastMove = null;
    this.drag = null;
    this.suppressClick = false;
    this.busy = true;
    this.onPointerMove = this.onPointerMove.bind(this);
    this.onPointerUp = this.onPointerUp.bind(this);
    this.buildDom();
  }

  async start() {
    try {
      await this.engine.request(REQ.INIT, { engineUrl: this.engineUrl });
      await this.refresh();
      this.busy = false;
    } catch (error) {
      this.setStatus(`Engine unavailable: ${error.message}`);
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
      button.dataset.shade = (Math.floor(index / 8) + (index % 8)) % 2 === 0 ? "light" : "dark";
      if (index >= 56) button.dataset.file = square[0];
      if (index % 8 === 0) button.dataset.rank = square[1];

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
    const replyLabel = document.createElement("label");
    replyLabel.className = "chess-toggle";
    replyLabel.htmlFor = replyToggle.id;
    replyLabel.append(replyToggle, document.createTextNode(" Placeholder replies"));

    const promotion = document.createElement("div");
    promotion.className = "chess-promotion";
    promotion.hidden = true;

    const controls = document.createElement("div");
    controls.className = "chess-controls";
    controls.append(newGame, replyLabel);

    const panel = document.createElement("div");
    panel.className = "chess-panel";
    panel.append(status, controls, promotion);

    this.root.replaceChildren(board, panel);
    this.statusEl = status;
    this.promotionEl = promotion;
    this.replyToggle = replyToggle;
  }

  setStatus(text) {
    this.statusEl.textContent = text;
  }

  async refresh() {
    const [fen, moves, status] = await Promise.all([
      this.engine.request(REQ.FEN),
      this.engine.request(REQ.LEGAL_MOVES),
      this.engine.request(REQ.STATUS),
    ]);
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
    if (this.busy || !this.position || event.button !== 0 || !this.canPickUp(square)) return;
    this.suppressClick = false;
    this.drag = { from: square, startX: event.clientX, startY: event.clientY, active: false };
    window.addEventListener("pointermove", this.onPointerMove);
    window.addEventListener("pointerup", this.onPointerUp);
  }

  onPointerMove(event) {
    if (!this.drag) return;
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
    this.render();
  }

  moveGhost(x, y) {
    const ghost = this.drag.ghost;
    ghost.style.transform = `translate(${x - ghost.offsetWidth / 2}px, ${y - ghost.offsetHeight / 2}px)`;
  }

  onPointerUp(event) {
    window.removeEventListener("pointermove", this.onPointerMove);
    window.removeEventListener("pointerup", this.onPointerUp);
    const drag = this.drag;
    this.drag = null;
    if (!drag || !drag.active) return;

    drag.ghost.remove();
    this.suppressClick = true;
    this.render();

    const dropped = document.elementFromPoint(event.clientX, event.clientY)?.closest(".chess-square");
    if (dropped && dropped.dataset.square !== drag.from) this.attemptMove(drag.from, dropped.dataset.square);
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
    this.busy = true;
    try {
      const accepted = await this.engine.request(REQ.PUSH, { move });
      if (!accepted) {
        this.setStatus("The engine rejected that move.");
        return;
      }
      this.lastMove = parseUci(move);
      await this.refresh();
      if (this.replyToggle.checked) await this.engineReply();
    } catch (error) {
      this.setStatus(`Engine error: ${error.message}`);
    } finally {
      this.busy = false;
    }
  }

  async engineReply() {
    this.setStatus("Thinking…");
    const best = await this.engine.request(REQ.SEARCH, { movetimeMs: MOVETIME_MS, maxDepth: MAX_DEPTH });
    if (!best) return;
    await this.engine.request(REQ.PUSH, { move: best });
    this.lastMove = parseUci(best);
    await this.refresh();
  }

  async onNewGame() {
    this.busy = true;
    try {
      await this.engine.request(REQ.NEW_GAME);
      this.lastMove = null;
      this.hidePromotion();
      await this.refresh();
    } finally {
      this.busy = false;
    }
  }
}

export function mountChessBoard(root, options) {
  const board = new ChessBoard(root, options);
  board.start();
  return board;
}

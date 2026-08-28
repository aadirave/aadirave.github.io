/**
 * Placeholder backend. Speaks the frozen protocol so the page can be built and
 * deployed before the engine exists, and is **deleted** once the wasm module
 * lands -- it is not a stepping stone toward a JS engine.
 *
 * It is deliberately permissive rather than correct: it accepts any move
 * between two squares and answers with an arbitrary one. Teaching it the rules
 * would mean a second move generator competing with the engine's
 * perft-verified one, which is the whole thing this design exists to avoid.
 */

import { STATUS, START_FEN } from "./protocol.js";
import { colorOf, indexToSquare, parseFen, parseUci, squareToIndex, toFen } from "./fen.js";

const PROMOTION_PIECES = ["q", "r", "b", "n"];

export function createMockBackend() {
  let position = parseFen(START_FEN);

  const isPawnPromotion = (piece, toIndex) => (piece === "P" && toIndex < 8) || (piece === "p" && toIndex >= 56);

  return {
    newGame() {
      position = parseFen(START_FEN);
    },

    setFen(fen) {
      const parsed = parseFen(fen);
      if (parsed.pieces.every((piece) => piece === null)) return false;
      position = parsed;
      return true;
    },

    fen() {
      return toFen(position);
    },

    /** Every square-to-square hop that does not land on a friendly piece. */
    legalMoves() {
      const moves = [];
      position.pieces.forEach((piece, from) => {
        if (!piece || colorOf(piece) !== position.turn) return;
        for (let to = 0; to < 64; to += 1) {
          if (to === from) continue;
          if (colorOf(position.pieces[to]) === position.turn) continue;
          const uci = indexToSquare(from) + indexToSquare(to);
          if (isPawnPromotion(piece, to)) {
            PROMOTION_PIECES.forEach((promotion) => moves.push(uci + promotion));
          } else {
            moves.push(uci);
          }
        }
      });
      return moves.join(" ");
    },

    push(move) {
      const { from, to, promotion } = parseUci(move);
      const fromIndex = squareToIndex(from);
      const toIndex = squareToIndex(to);
      if (fromIndex < 0 || toIndex < 0 || fromIndex === toIndex) return false;

      const piece = position.pieces[fromIndex];
      if (!piece || colorOf(piece) !== position.turn) return false;

      const captured = position.pieces[toIndex] !== null;
      position.pieces[toIndex] = promotion ? (position.turn === "w" ? promotion.toUpperCase() : promotion) : piece;
      position.pieces[fromIndex] = null;

      const isPawn = piece.toLowerCase() === "p";
      position.halfmove = captured || isPawn ? 0 : position.halfmove + 1;
      if (position.turn === "b") position.fullmove += 1;
      position.turn = position.turn === "w" ? "b" : "w";
      return true;
    },

    /** The mock knows no terminal conditions, so every position is ongoing. */
    status() {
      return STATUS.ONGOING;
    },

    search(movetimeMs, maxDepth, onIteration) {
      const moves = this.legalMoves().split(" ").filter(Boolean);
      if (moves.length === 0) return "";
      const choice = moves[Math.floor(Math.random() * moves.length)];
      onIteration({ depth: 1, score: 0, nodes: moves.length, pv: choice });
      return choice;
    },
  };
}

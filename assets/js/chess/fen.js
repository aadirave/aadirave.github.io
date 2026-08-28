/**
 * FEN and coordinate notation. Pure transcription -- no move generation, no
 * legality, nothing that could disagree with the engine about the rules.
 *
 * Board indices run 0 = a8 to 63 = h1, i.e. FEN reading order.
 */

const FILES = "abcdefgh";

export function indexToSquare(index) {
  return FILES[index % 8] + (8 - Math.floor(index / 8));
}

export function squareToIndex(square) {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  if (file < 0 || !(rank >= 1 && rank <= 8)) return -1;
  return (8 - rank) * 8 + file;
}

export function colorOf(piece) {
  if (!piece) return null;
  return piece === piece.toUpperCase() ? "w" : "b";
}

/**
 * @returns {{pieces: (string|null)[], turn: string, castling: string, enPassant: string, halfmove: number, fullmove: number}}
 * @throws {Error} if the placement field isn't 8 ranks of 8 files each -- this
 *   runs on every backend reply, so a malformed FEN must fail loudly here
 *   rather than silently overrun `pieces` and corrupt the board.
 */
export function parseFen(fen) {
  const [placement, turn = "w", castling = "-", enPassant = "-", halfmove = "0", fullmove = "1"] = fen.trim().split(/\s+/);
  const ranks = placement.split("/");
  if (ranks.length !== 8) throw new Error(`invalid FEN placement "${placement}": expected 8 ranks, got ${ranks.length}`);

  const pieces = new Array(64).fill(null);
  let index = 0;
  for (const rank of ranks) {
    let files = 0;
    for (const char of rank) {
      if (char >= "1" && char <= "8") {
        files += Number(char);
        index += Number(char);
        continue;
      }
      files += 1;
      if (index < 0 || index > 63) throw new Error(`invalid FEN placement "${placement}": rank overruns the board`);
      pieces[index] = char;
      index += 1;
    }
    if (files !== 8) throw new Error(`invalid FEN placement "${placement}": rank "${rank}" does not sum to 8 files`);
  }
  return { pieces, turn, castling, enPassant, halfmove: Number(halfmove), fullmove: Number(fullmove) };
}

export function toFen(position) {
  const rows = [];
  for (let rank = 0; rank < 8; rank += 1) {
    let row = "";
    let empty = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = position.pieces[rank * 8 + file];
      if (piece) {
        if (empty > 0) {
          row += empty;
          empty = 0;
        }
        row += piece;
      } else {
        empty += 1;
      }
    }
    if (empty > 0) row += empty;
    rows.push(row);
  }
  return [rows.join("/"), position.turn, position.castling || "-", position.enPassant || "-", position.halfmove, position.fullmove].join(" ");
}

/** Splits a UCI move such as `e7e8q` into its parts. */
export function parseUci(move) {
  return { from: move.slice(0, 2), to: move.slice(2, 4), promotion: move.slice(4, 5) || "" };
}

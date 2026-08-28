/**
 * Frozen UI <-> engine-Worker protocol.
 *
 * Both sides of the seam are written against this file so that swapping the
 * placeholder backend for the real WebAssembly module is a one-line change in
 * `worker.js`. Freezing it before either side existed is deliberate: a mock and
 * a module written against drifting message shapes get debugged twice.
 *
 * Every request carries an `id`; the Worker answers exactly one `result` (or
 * `error`) per request with the same `id`. `info` messages are unsolicited and
 * carry no `id` -- they are search progress, emitted while a `search` request
 * is still outstanding.
 *
 *   UI -> Worker                                  answered with `result.value`
 *   ------------------------------------------    ---------------------------
 *   {type: "init",        id, engineUrl}          null            (then "ready")
 *   {type: "new_game",    id}                     null
 *   {type: "set_fen",     id, fen}                boolean
 *   {type: "fen",         id}                     string  (FEN)
 *   {type: "legal_moves", id}                     string  (space-separated UCI)
 *   {type: "push",        id, move}               boolean (false = rejected)
 *   {type: "status",      id}                     number  (STATUS below)
 *   {type: "search",      id, movetimeMs, maxDepth} string (bestmove UCI)
 *
 *   Worker -> UI
 *   ------------------------------------------------------------------------
 *   {type: "ready",  id}                          backend loaded, accepting work
 *   {type: "result", id, value}
 *   {type: "info",   depth, score, nodes, pv}     from the engine's per-iteration hook
 *   {type: "error",  id?, message}                `id` absent = not tied to a request
 *
 * The request set is a 1:1 mirror of the `ce_*` C API the wasm module exports
 * (`ce_new_game`, `ce_set_fen`, `ce_fen`, `ce_legal_moves`, `ce_push`,
 * `ce_status`, `ce_search`), so the Worker stays a thin dispatcher.
 *
 * `engineUrl` is passed in as data because a Worker is a static file: it gets
 * no Liquid pass and therefore cannot resolve a site path itself. The page
 * resolves it with `relative_url` and hands it over.
 */

export const REQ = {
  INIT: "init",
  NEW_GAME: "new_game",
  SET_FEN: "set_fen",
  FEN: "fen",
  LEGAL_MOVES: "legal_moves",
  PUSH: "push",
  STATUS: "status",
  SEARCH: "search",
};

export const RES = {
  READY: "ready",
  RESULT: "result",
  INFO: "info",
  ERROR: "error",
};

/** Mirrors the enum returned by `ce_status()`. */
export const STATUS = {
  ONGOING: 0,
  CHECKMATE: 1,
  STALEMATE: 2,
  DRAW_REPETITION: 3,
  DRAW_FIFTY_MOVE: 4,
  DRAW_INSUFFICIENT_MATERIAL: 5,
};

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

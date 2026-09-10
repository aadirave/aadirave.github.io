/**
 * WebAssembly backend -- the real engine, replacing the Phase-1 `mock.js`.
 *
 * Thin `cwrap` wrappers over the nine `ce_*` exports, which the frozen
 * protocol mirrors 1:1 (`protocol.js`). The wrappers are built once at
 * construction rather than `ccall`-ing per request: the module is long-lived
 * and every board interaction crosses this boundary.
 *
 * `ce_perft` and `ce_search_detail` are exported by the module but not wrapped
 * here -- they exist for the native-vs-wasm equivalence gates in the engine
 * repo, and the board has no use for either.
 */

export function createWasmBackend(module) {
  // ce_set_fen / ce_push return int, not bool, across the C boundary.
  const ce = {
    newGame: module.cwrap("ce_new_game", null, []),
    setFen: module.cwrap("ce_set_fen", "number", ["string"]),
    fen: module.cwrap("ce_fen", "string", []),
    legalMoves: module.cwrap("ce_legal_moves", "string", []),
    push: module.cwrap("ce_push", "number", ["string"]),
    status: module.cwrap("ce_status", "number", []),
    search: module.cwrap("ce_search", "string", ["number", "number"]),
  };

  return {
    newGame: () => ce.newGame(),
    setFen: (fen) => ce.setFen(fen) !== 0,
    fen: () => ce.fen(),
    legalMoves: () => ce.legalMoves(),
    push: (move) => ce.push(move) !== 0,
    status: () => ce.status(),

    /**
     * `onIteration` is deliberately ignored. The engine's per-iteration hook
     * lives in C++ (`ce_search`'s `on_iteration`) and calls `postMessage`
     * itself, emitting exactly the protocol's `info` shape -- it has to,
     * because the Worker's JS thread is blocked inside this call for the whole
     * search and could not run a JS callback until after the result it is
     * meant to precede. Accepting the parameter keeps the backend interface
     * identical to the one `worker.js` dispatches against.
     */
    search: (movetimeMs, maxDepth) => ce.search(movetimeMs, maxDepth),
  };
}

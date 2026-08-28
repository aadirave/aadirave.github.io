/**
 * Engine Worker. The whole engine runs here rather than on the UI thread
 * because GitHub Pages cannot set the COOP/COEP headers that `SharedArrayBuffer`
 * -- and therefore Emscripten's pthread support -- requires. A Worker gives the
 * same "search without freezing the page" property with no special headers, at
 * the cost of the search being stoppable only by terminating the Worker.
 *
 * This file is a thin dispatcher over a backend object; see `protocol.js` for
 * the message schema it implements.
 */

import { REQ, RES } from "./protocol.js";
import { createMockBackend } from "./mock.js";

let backend = null;

/**
 * `engineUrl` is the page-resolved URL of the Emscripten glue. It is unused
 * while the backend is mocked, but is part of the protocol from day one so
 * that wiring the real module up is a change to this function alone:
 *
 *   const factory = (await import(engineUrl)).default;
 *   const module = await factory();
 *   return createWasmBackend(module);   // ccall wrappers over the ce_* exports
 */
async function loadBackend(engineUrl) {
  return createMockBackend();
}

function reply(id, value) {
  self.postMessage({ type: RES.RESULT, id, value });
}

self.onmessage = async (event) => {
  const request = event.data || {};
  const { id, type } = request;

  try {
    if (type === REQ.INIT) {
      backend = await loadBackend(request.engineUrl);
      backend.newGame();
      self.postMessage({ type: RES.READY, id });
      return;
    }

    if (!backend) throw new Error(`received "${type}" before init`);

    switch (type) {
      case REQ.NEW_GAME:
        backend.newGame();
        reply(id, null);
        break;
      case REQ.SET_FEN:
        reply(id, backend.setFen(request.fen));
        break;
      case REQ.FEN:
        reply(id, backend.fen());
        break;
      case REQ.LEGAL_MOVES:
        reply(id, backend.legalMoves());
        break;
      case REQ.PUSH:
        reply(id, backend.push(request.move));
        break;
      case REQ.STATUS:
        reply(id, backend.status());
        break;
      case REQ.SEARCH:
        reply(
          id,
          backend.search(request.movetimeMs, request.maxDepth, (info) => self.postMessage({ type: RES.INFO, ...info }))
        );
        break;
      default:
        throw new Error(`unknown request type "${type}"`);
    }
  } catch (error) {
    self.postMessage({ type: RES.ERROR, id, message: error.message });
  }
};

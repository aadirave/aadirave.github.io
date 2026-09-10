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
import { createWasmBackend } from "./wasm.js";

let backend = null;

/**
 * `engineUrl` is the page-resolved URL of the Emscripten glue, passed in as
 * data because a Worker gets no Liquid pass and so cannot resolve a site path
 * itself. The glue locates its own `.wasm` sibling relative to `import.meta.url`,
 * so only this one path has to cross the seam -- and it stays correct under
 * both the blank baseurl and `--baseurl /al-folio`.
 */
async function loadBackend(engineUrl) {
  if (!engineUrl) throw new Error("init requires an engineUrl");
  const factory = (await import(engineUrl)).default;
  return createWasmBackend(await factory());
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

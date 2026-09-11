const { test, expect } = require("@playwright/test");
const { preparePage, stabilizeVisuals } = require("./helpers");

// No `test.skip` on mobile here, unlike several specs in interactions.spec.js: the
// board sizes itself from `min(92vw, 40rem)` (a responsive unit, not a desktop-only
// hover/alignment contract), and Playwright's `.click()` drives a real click event
// on the iPhone 12 project the same as it does on desktop. All three tests below
// are about engine wiring and layout math that don't vary by viewport.

/**
 * The engine is WebAssembly, compiled and instantiated inside a Worker. That
 * round-trip (fetch + compile + instantiate, then a live FEN/legal-moves/status
 * request) can take several seconds under a cold cache -- well past the config's
 * 10s default assertion timeout -- so every test waits on this before touching
 * the board.
 */
async function waitForEngineReady(page) {
  await expect(page.locator(".chess-status")).toContainText(/to move/i, { timeout: 60000 });
}

test("board squares are square and evenly sized", async ({ page }) => {
  await preparePage(page, "light");
  await page.goto("/al-folio/chess/", { waitUntil: "networkidle" });
  await stabilizeVisuals(page);
  await waitForEngineReady(page);

  // Regression test for the bug shipped in fc503a0: `.chess-board` set
  // `grid-template-columns` but not `grid-template-rows`, so rows without an
  // explicit track size fell back to sizing from their content -- the four
  // ranks holding pieces (with an <img> child) rendered taller than the four
  // empty ranks. Every square must come out the same width, the same height,
  // and square (width ~= height), or that bug is back.
  const rects = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".chess-square")).map((el) => {
      const rect = el.getBoundingClientRect();
      return { width: rect.width, height: rect.height };
    })
  );

  expect(rects).toHaveLength(64);
  const [{ width: firstWidth, height: firstHeight }] = rects;
  for (const { width, height } of rects) {
    // Subpixel rounding across 64 flex/grid boxes, not a real size difference.
    expect(Math.abs(width - firstWidth)).toBeLessThanOrEqual(1);
    expect(Math.abs(height - firstHeight)).toBeLessThanOrEqual(1);
  }
  expect(Math.abs(firstWidth - firstHeight)).toBeLessThanOrEqual(1);
});

test("the real engine is driving the board", async ({ page }) => {
  await preparePage(page, "light");
  await page.goto("/al-folio/chess/", { waitUntil: "networkidle" });
  await stabilizeVisuals(page);
  await waitForEngineReady(page);

  // Nothing below completes a legal move (e2 is selected then deselected;
  // a1's rook has no moves to offer), so the engine's own reply would never
  // fire here regardless -- but unchecking is one line of insurance against
  // an accidental extra click completing a move and the engine replying
  // mid-assertion, which would invalidate the square counts below.
  await page.locator("#chess-auto-reply").uncheck();

  // The deleted Phase-1 mock (mock.js) was permissive by design and would
  // have lit up dozens of squares for any selected piece. The real,
  // perft-verified wasm move generator gives e2's pawn exactly two
  // destinations from the start position -- e3 and e4 -- so this specific
  // count is what distinguishes the real engine from a placeholder that
  // merely "looks like" it works.
  const e2 = page.locator('[aria-label^="e2,"]');
  await expect(e2).toHaveAttribute("aria-label", "e2, white pawn");
  await e2.click();

  await expect(page.locator(".chess-square.is-target")).toHaveCount(2);
  await expect(page.locator('[aria-label^="e3,"]')).toHaveClass(/is-target/);
  await expect(page.locator('[aria-label^="e4,"]')).toHaveClass(/is-target/);

  // Deselect, then confirm the a1 rook -- boxed in by its own knight and
  // pawn at the start position -- offers nothing. It should never even
  // become selected: `canPickUp()` gates picking a square up on it having a
  // legal move, and the rook has none yet.
  await e2.click();
  await page.locator('[aria-label^="a1,"]').click();
  await expect(page.locator(".chess-square.is-selected")).toHaveCount(0);
  await expect(page.locator(".chess-square.is-target")).toHaveCount(0);
  await expect(page.locator(".chess-square.is-capture")).toHaveCount(0);
});

test("piece images resolve under the site baseurl", async ({ page }) => {
  await preparePage(page, "light");
  await page.goto("/al-folio/chess/", { waitUntil: "networkidle" });
  await stabilizeVisuals(page);
  await waitForEngineReady(page);

  // `pieceBaseUrl` is one of three Liquid-resolved URLs (`relative_url`)
  // handed to the JS as page data. Get the baseurl wrong and `src` is still
  // set -- a check that merely looks for a `src` attribute would still pass
  // -- but the request 404s and the image never actually decodes.
  // `naturalWidth` only goes non-zero on a real decoded image, so it's the
  // one check a broken baseurl can't fake. `render()` sets `src` synchronously
  // once the engine answers, but the browser still has to fetch and decode
  // each SVG afterwards, so wait for that before reading naturalWidth.
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll(".chess-square img.chess-piece"))
        .filter((img) => !img.hidden)
        .every((img) => img.complete && img.naturalWidth > 0),
    { timeout: 20000 }
  );

  const images = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".chess-square img.chess-piece"))
      .filter((img) => !img.hidden)
      .map((img) => ({ src: img.getAttribute("src"), naturalWidth: img.naturalWidth }))
  );

  // 32 pieces on the start position: 16 white, 16 black.
  expect(images).toHaveLength(32);
  for (const image of images) {
    expect(image.src).toBeTruthy();
    expect(image.naturalWidth).toBeGreaterThan(0);
  }
});

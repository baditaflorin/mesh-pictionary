import { expect, test } from "@playwright/test";
import { openTwoPeers } from "@baditaflorin/mesh-common/testing";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")) as {
  name: string;
};
const storagePrefix = pkg.name;

test("A becomes drawer; B sees locked commit; B's guess shows on A", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");

    await a.getByRole("button", { name: /I'll draw/ }).click();

    await expect(b.locator(".pic-word-locked")).toBeVisible();
    await expect(b.locator(".pic-status")).toContainText("drawing");

    await b.getByPlaceholder("your guess").fill("pizza");
    await b.getByRole("button", { name: "send", exact: true }).click();

    await expect(a.locator(".pic-guesses li")).toContainText(["bob"]);
  } finally {
    await cleanup();
  }
});

// Counts non-background pixels on the canvas. Background is #0e1117 (14,17,23).
// Any drawn stroke leaves visibly-different pixels. Returns the count so the
// assertion is "B's canvas went from empty to painted" rather than a flake.
async function paintedPixelCount(page: import("@playwright/test").Page): Promise<number> {
  return page.locator(".pic-canvas").evaluate((el) => {
    const c = el as HTMLCanvasElement;
    const ctx = c.getContext("2d");
    if (!ctx) return -1;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let painted = 0;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!,
        g = data[i + 1]!,
        b = data[i + 2]!;
      // tolerate antialiasing around the #0e1117 background
      if (Math.abs(r - 14) + Math.abs(g - 17) + Math.abs(b - 23) > 24) painted++;
    }
    return painted;
  });
}

test("drawer's strokes render on the guesser's canvas (mesh-synced drawing)", async ({
  browser,
  baseURL,
}) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await b.getByPlaceholder("your name").fill("bob");

    await a.getByRole("button", { name: /I'll draw/ }).click();
    await expect(b.locator(".pic-word-locked")).toBeVisible();

    // Before A draws, B's shared canvas must be blank.
    expect(await paintedPixelCount(b)).toBe(0);

    // Drive a real stroke on A's canvas via synthetic pointer events, then let
    // onPointerUp push it to the "strokes" Y.Array.
    await a.locator(".pic-canvas").evaluate((el) => {
      const c = el as HTMLCanvasElement;
      const rect = c.getBoundingClientRect();
      const at = (x: number, y: number, type: string) =>
        c.dispatchEvent(
          new PointerEvent(type, {
            pointerId: 1,
            clientX: rect.left + x,
            clientY: rect.top + y,
            bubbles: true,
          }),
        );
      c.setPointerCapture = () => {};
      at(40, 40, "pointerdown");
      for (let i = 1; i <= 20; i++) at(40 + i * 8, 40 + i * 6, "pointermove");
      at(200, 160, "pointerup");
    });

    // The OPPOSITE peer (B, the guesser) must now see the stroke rendered on its
    // own canvas — strokes crossed the mesh via the "strokes" Y.Array. Fails if
    // drawing is local-only (e.g. never pushed to the doc).
    await expect.poll(() => paintedPixelCount(b), { timeout: 5000 }).toBeGreaterThan(50);
  } finally {
    await cleanup();
  }
});

test("reveal phase verifies the commitment", async ({ browser, baseURL }) => {
  const { a, b, cleanup } = await openTwoPeers(browser, baseURL ?? "", { storagePrefix });
  try {
    await a.getByPlaceholder("your name").fill("alice");
    await a.getByRole("button", { name: /I'll draw/ }).click();
    await a.getByRole("button", { name: "end & reveal", exact: true }).click();
    await expect(b.locator(".pic-verify.is-ok")).toBeVisible();
  } finally {
    await cleanup();
  }
});

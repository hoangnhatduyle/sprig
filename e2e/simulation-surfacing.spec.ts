import { expect, test, type Locator, type Page } from "@playwright/test";

// The 3D canvas is an angled orbit-camera perspective view, not a flat
// top-down grid — the pixel that maps to a given cell mesh isn't
// predictable from the canvas's own bounding box alone, so a single
// center-click is not a reliable way to hit a cell (confirmed against this
// same canvas with zero equipment installed, before adding this helper).
// Scanning a few candidate points and stopping once one resolves to a
// selection is what makes this a real regression guard for "does an
// equipment mesh block the click", not a flaky guess at one exact pixel.
async function clickSomeCell(page: Page, viewer: Locator): Promise<void> {
  const box = await viewer.boundingBox();
  if (!box) {
    throw new Error("3D viewport has no bounding box");
  }
  const candidates = [
    [0.5, 0.55],
    [0.4, 0.5],
    [0.6, 0.5],
    [0.5, 0.4],
    [0.5, 0.65],
    [0.35, 0.6],
    [0.65, 0.6],
  ];
  // docs/Sprig3D.glb (~7.7MB) loads asynchronously via useGLTF/Suspense —
  // the canvas element exists in the DOM before the model's Cell_* meshes
  // are registered, so an immediate click can land on nothing. Two passes
  // over the candidate list, with a short settle wait first, gives the
  // model a real chance to finish loading in a slow/software-rendered
  // headless environment without hard-coding a single fixed delay.
  //
  // Uses viewer.click({ position }) — relative to the element and
  // auto-scrolling it into view — rather than page.mouse.click(pageX,
  // pageY): the viewport often renders below the fold on a short test
  // viewport, and raw page coordinates land on nothing once that happens.
  for (let pass = 0; pass < 2; pass += 1) {
    if (pass > 0) {
      await page.waitForTimeout(2_000);
    }
    for (const [fx, fy] of candidates) {
      await viewer.click({ position: { x: box.width * fx, y: box.height * fy } });
      const opened = await page
        .getByRole("complementary", { name: "Cell details" })
        .isVisible()
        .catch(() => false);
      if (opened) {
        return;
      }
    }
  }
  throw new Error("No candidate point resolved to a cell selection");
}

// Traces to SPEC-SURFACE-001. Exercises the Phase A surfacing work end to
// end against the real dev server/database — pairs with the unit/component
// coverage in src/domain/garden-3d/*.test.ts and
// src/components/garden/spec-surface-001.test.tsx, which run without a
// browser.

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "small desktop", width: 1024, height: 768 },
  { name: "laptop", width: 1280, height: 800 },
  { name: "large desktop", width: 1920, height: 1080 },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("weather banner is visible with no horizontal overflow", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByText("Today in the garden")).toBeVisible();

      const pageWidth = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client + 1);
    });
  });
}

test.describe("simulation clock", () => {
  test("changing the speed preset round-trips through the server without error", async ({ page }) => {
    await page.goto("/");
    const select = page.getByLabel("Simulation speed");
    await expect(select).toBeVisible();

    await select.selectOption("1000");
    await page.getByRole("button", { name: "Advance now" }).click();
    // setClockRateAction anchors the new epoch at the current sim time, so
    // the calendar date won't visibly jump immediately after a real-time
    // instant — what this proves is the round trip (set rate -> refresh ->
    // re-render) completes cleanly and the selection survives it, not a
    // literal date change.
    await expect(page.getByText(/couldn't/i)).not.toBeVisible();
    await expect(select).toHaveValue("1000");
  });
});

test.describe("bed equipment", () => {
  test("installing equipment doesn't break 3D cell selection", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Conditions" })).toBeVisible();

    // Select the first bed checkbox under "Beds".
    await page.getByRole("checkbox", { name: "Left Bed" }).check();
    await page.getByRole("button", { name: "Install" }).click();
    await expect(page.getByText(/installed on 1 bed/)).toBeVisible();

    // The 3D viewport must still resolve clicks after an equipment mesh is
    // rendered above the grid — the raycast-blocking regression this guards
    // against (see BedEquipment.tsx's NO_RAYCAST comment). Only meaningful
    // where the browser actually has a WebGL2 context (use-webgl-support.ts) —
    // some headless/sandboxed environments report none, in which case the
    // app itself falls back to a text notice instead of a <canvas>, and
    // there's no raycasting to guard.
    const viewer = page.getByTestId("garden-3d-viewport");
    await expect(viewer).toBeVisible();
    const hasCanvas = (await viewer.locator("canvas").count()) > 0;
    if (hasCanvas) {
      await clickSomeCell(page, viewer);
      await expect(page.getByRole("complementary", { name: "Cell details" })).toBeVisible();
    } else {
      await expect(viewer.getByText(/needs WebGL/i)).toBeVisible();
    }

    // Clean up: remove the equipment we just installed so the e2e run
    // doesn't leave a permanent side effect on the dev database.
    const removeButtons = page.getByRole("button", { name: "Remove" });
    if (await removeButtons.count()) {
      await removeButtons.first().click();
    }
  });
});

test.describe("3D legend", () => {
  test("is present and collapsible", async ({ page }) => {
    await page.goto("/");
    const legend = page.getByText("What am I looking at?");
    await expect(legend).toBeVisible();
    await legend.click();
    await expect(page.getByText(/Lighting follows the real sun position/)).toBeVisible();
  });
});

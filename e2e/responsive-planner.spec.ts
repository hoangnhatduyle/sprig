import { expect, test } from "@playwright/test";

const VIEWPORTS = [
  { name: "mobile", width: 390, height: 844, bedsPerRow: 1, viewerAspect: 4 / 3, minCellSize: 44 },
  { name: "tablet", width: 768, height: 1024, bedsPerRow: 2, viewerAspect: 4 / 3, minCellSize: 44 },
  { name: "small desktop", width: 1024, height: 768, bedsPerRow: 2, viewerAspect: 4 / 3, minCellSize: 44 },
  { name: "laptop", width: 1280, height: 800, bedsPerRow: 2, viewerAspect: 3 / 2, minCellSize: 30 },
  { name: "large desktop", width: 1920, height: 1080, bedsPerRow: 2, viewerAspect: 5 / 4, minCellSize: 44 },
] as const;

for (const viewport of VIEWPORTS) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("keeps the planner readable without horizontal overflow", async ({ page }) => {
      await page.goto("/");
      await expect(page.getByRole("heading", { name: "Sprig", exact: true })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Seeds & yield" })).toBeVisible();
      await expect(page.getByRole("tab", { name: /Seeds/ })).toBeVisible();
      await page.getByRole("tab", { name: /Yield/ }).click();
      await expect(page.getByRole("heading", { name: "Totals by plant and unit" })).toBeVisible();
      await expect(page.getByRole("searchbox", { name: "Search inventory" })).toBeVisible();
      await page.getByRole("tab", { name: /Seeds/ }).click();

      const pageWidth = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(pageWidth.scroll).toBeLessThanOrEqual(pageWidth.client + 1);

      const beds = page.locator("[data-bed-card]");
      await expect(beds).toHaveCount(2);
      const firstBed = await beds.nth(0).boundingBox();
      const secondBed = await beds.nth(1).boundingBox();
      expect(firstBed).not.toBeNull();
      expect(secondBed).not.toBeNull();

      if (viewport.bedsPerRow === 1) {
        expect(secondBed!.y).toBeGreaterThan(firstBed!.y + firstBed!.height - 1);
      } else {
        expect(Math.abs(secondBed!.y - firstBed!.y)).toBeLessThan(2);
      }

      const firstCell = beds.nth(0).getByRole("button").first();
      const cellBox = await firstCell.boundingBox();
      expect(cellBox).not.toBeNull();
      expect(cellBox!.width).toBeGreaterThanOrEqual(viewport.minCellSize);
      expect(cellBox!.height).toBeGreaterThanOrEqual(viewport.minCellSize);

      const viewer = page.getByTestId("garden-3d-viewport");
      await expect(viewer).toBeVisible();
      const viewerBox = await viewer.boundingBox();
      expect(viewerBox).not.toBeNull();
      expect(viewerBox!.width / viewerBox!.height).toBeCloseTo(viewport.viewerAspect, 1);
    });
  });
}

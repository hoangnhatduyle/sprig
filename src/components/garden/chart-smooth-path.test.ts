import { describe, expect, it } from "vitest";
import { buildSmoothPath } from "./chart-smooth-path";

describe("buildSmoothPath", () => {
  it("returns an empty string for no points", () => {
    expect(buildSmoothPath([])).toBe("");
  });

  it("returns a bare moveto for a single point", () => {
    expect(buildSmoothPath([{ x: 5, y: 10 }])).toBe("M 5,10");
  });

  it("starts with a moveto at the first point and ends at the last point", () => {
    const path = buildSmoothPath([
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: -5 },
      { x: 30, y: 0 },
    ]);

    expect(path.startsWith("M 0,0")).toBe(true);
    expect(path.endsWith("30,0")).toBe(true);
  });

  it("emits one cubic-bezier segment per point after the first", () => {
    const points = [
      { x: 0, y: 0 },
      { x: 10, y: 5 },
      { x: 20, y: -5 },
    ];

    const path = buildSmoothPath(points);
    const segmentCount = path.split(" C ").length - 1;
    expect(segmentCount).toBe(points.length - 1);
  });
});

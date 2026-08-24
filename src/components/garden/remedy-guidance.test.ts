import { describe, expect, it } from "vitest";
import { getRemedy, isDialActionable } from "./remedy-guidance";

describe("getRemedy", () => {
  it("maps drought to a water action", () => {
    expect(getRemedy("drought", false).action).toEqual({ kind: "water" });
  });

  it("maps heat to a shade-cloth action", () => {
    expect(getRemedy("heat", false).action).toEqual({ kind: "shade-cloth" });
  });

  it("maps shade to a grow-light action", () => {
    expect(getRemedy("shade", false).action).toEqual({ kind: "grow-light" });
  });

  it("maps nutrient to a fertilize action", () => {
    expect(getRemedy("nutrient", false).action).toEqual({ kind: "fertilize" });
  });

  it("maps overwater to an open-irrigation action, not a direct apply", () => {
    expect(getRemedy("overwater", false).action).toEqual({ kind: "open-irrigation" });
  });

  it.each(["cold", "wind", "transplantShock"])("has no in-app action for %s", (dial) => {
    expect(getRemedy(dial, false).action).toBeNull();
  });

  it("routes pestDisease to fungicide when the cell has an active infection", () => {
    const remedy = getRemedy("pestDisease", true);
    expect(remedy.action).toEqual({ kind: "fungicide" });
  });

  it("routes pestDisease to no action when pest pressure isn't backed by an infection", () => {
    const remedy = getRemedy("pestDisease", false);
    expect(remedy.action).toBeNull();
  });

  it("falls back to an informational remedy for an unrecognized dial", () => {
    const remedy = getRemedy("somethingNew", false);
    expect(remedy.action).toBeNull();
    expect(remedy.steps.length).toBeGreaterThan(0);
  });

  it("every remedy carries at least one real-world step regardless of actionability", () => {
    for (const dial of ["drought", "heat", "shade", "overwater", "nutrient", "cold", "wind", "transplantShock"]) {
      expect(getRemedy(dial, false).steps.length).toBeGreaterThan(0);
    }
  });
});

describe("isDialActionable", () => {
  it("is true for dials with a real in-app remedy", () => {
    expect(isDialActionable("drought", false)).toBe(true);
  });

  it("is false for dials with no in-app remedy", () => {
    expect(isDialActionable("cold", false)).toBe(false);
    expect(isDialActionable("wind", false)).toBe(false);
    expect(isDialActionable("transplantShock", false)).toBe(false);
  });

  it("depends on hasActiveInfection for pestDisease", () => {
    expect(isDialActionable("pestDisease", true)).toBe(true);
    expect(isDialActionable("pestDisease", false)).toBe(false);
  });
});

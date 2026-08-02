import { describe, expect, it } from "vitest";
import { companionEffectsForSpecies } from "./companion-catalog";
import { computeEcologyModifiersForBed, NEUTRAL_MODIFIERS, type EcologyCell } from "./ecology-service";

describe("companionEffectsForSpecies", () => {
  it("returns the nitrogen-fixing source for pole-bean", () => {
    const effects = companionEffectsForSpecies("pole-bean");
    expect(effects).toHaveLength(1);
    expect(effects[0].kind).toBe("NITROGEN_FIX");
  });

  it("returns the pollinator-boost and predator-attract sources for marigold", () => {
    const effects = companionEffectsForSpecies("marigold");
    expect(effects).toHaveLength(2);
    expect(effects.map((effect) => effect.kind).sort()).toEqual(["POLLINATOR_BOOST", "PREDATOR_ATTRACT"]);
  });

  it("returns nothing for a species with no companion effect", () => {
    expect(companionEffectsForSpecies("tomato")).toHaveLength(0);
  });
});

describe("computeEcologyModifiersForBed", () => {
  function cell(cellId: string, column: number, row: number, speciesKeys: string[]): EcologyCell {
    return { cellId, column, row, speciesKeys };
  }

  it("a cell with no nearby companion sources gets neutral modifiers", () => {
    const cells = [cell("a", 1, 1, ["tomato"])];
    const modifiers = computeEcologyModifiersForBed(cells);
    expect(modifiers.get("a")).toEqual(NEUTRAL_MODIFIERS);
  });

  it("a same-cell companion source applies at full strength", () => {
    const cells = [cell("a", 1, 1, ["tomato", "marigold"])];
    const modifiers = computeEcologyModifiersForBed(cells);
    expect(modifiers.get("a")?.pollinatorBoost).toBeCloseTo(0.35, 10);
  });

  it("an orthogonally-adjacent companion source applies at half strength", () => {
    const cells = [cell("a", 1, 1, ["cucumber"]), cell("b", 1, 2, ["marigold"])];
    const modifiers = computeEcologyModifiersForBed(cells);
    expect(modifiers.get("a")?.pollinatorBoost).toBeCloseTo(0.175, 10);
  });

  it("a diagonally-adjacent companion source has no effect (Manhattan distance > 1)", () => {
    const cells = [cell("a", 1, 1, ["cucumber"]), cell("b", 2, 2, ["marigold"])];
    const modifiers = computeEcologyModifiersForBed(cells);
    expect(modifiers.get("a")?.pollinatorBoost).toBe(0);
  });

  it("a nitrogen-fixing neighbor contributes nitrogenTrickle, not pollinatorBoost", () => {
    const cells = [cell("a", 1, 1, ["tomato"]), cell("b", 2, 1, ["pole-bean"])];
    const modifiers = computeEcologyModifiersForBed(cells);
    expect(modifiers.get("a")?.nitrogenTrickle).toBeGreaterThan(0);
    expect(modifiers.get("a")?.pollinatorBoost).toBe(0);
  });

  it("multiple nearby sources of the same kind stack additively", () => {
    // Two separate marigold neighbors, each orthogonally adjacent to "a"
    // from a different direction.
    const cells = [cell("a", 1, 1, ["cucumber"]), cell("b", 1, 2, ["marigold"]), cell("c", 2, 1, ["marigold"])];
    const soloModifiers = computeEcologyModifiersForBed([cell("a", 1, 1, ["cucumber"]), cell("b", 1, 2, ["marigold"])]);
    const doubledModifiers = computeEcologyModifiersForBed(cells);
    expect(doubledModifiers.get("a")!.pollinatorBoost).toBeGreaterThan(soloModifiers.get("a")!.pollinatorBoost);
  });
});

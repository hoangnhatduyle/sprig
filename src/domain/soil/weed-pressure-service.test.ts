import { describe, expect, it } from "vitest";
import { stepWeedPressure, weedCompetitionPenalty, WEED_COMPETITION_MAX_PENALTY } from "./weed-pressure-service";

describe("stepWeedPressure", () => {
  it("grows on bare, unmulched soil under favorable conditions", () => {
    const next = stepWeedPressure({
      weedPressureFraction: 0.1,
      mulchFactor: 1,
      soilMoistureFraction: 0.55,
      soilTempC: 20,
    });
    expect(next).toBeGreaterThan(0.1);
  });

  it("mulch (lower mulchFactor) suppresses growth relative to bare soil", () => {
    const bare = stepWeedPressure({ weedPressureFraction: 0.1, mulchFactor: 1, soilMoistureFraction: 0.55, soilTempC: 20 });
    const mulched = stepWeedPressure({ weedPressureFraction: 0.1, mulchFactor: 0.6, soilMoistureFraction: 0.55, soilTempC: 20 });
    expect(mulched).toBeLessThan(bare);
  });

  it("stays within 0..1", () => {
    const next = stepWeedPressure({ weedPressureFraction: 0.99, mulchFactor: 1, soilMoistureFraction: 0.55, soilTempC: 20 });
    expect(next).toBeLessThanOrEqual(1);
  });

  it("cold, dry conditions slow weed growth", () => {
    const favorable = stepWeedPressure({ weedPressureFraction: 0.1, mulchFactor: 1, soilMoistureFraction: 0.55, soilTempC: 20 });
    const unfavorable = stepWeedPressure({ weedPressureFraction: 0.1, mulchFactor: 1, soilMoistureFraction: 0.05, soilTempC: 2 });
    expect(unfavorable).toBeLessThan(favorable);
  });
});

describe("weedCompetitionPenalty", () => {
  it("is zero with no weed pressure", () => {
    expect(weedCompetitionPenalty(0)).toBe(0);
  });

  it("is capped at WEED_COMPETITION_MAX_PENALTY at full pressure", () => {
    expect(weedCompetitionPenalty(1)).toBeCloseTo(WEED_COMPETITION_MAX_PENALTY, 5);
  });
});

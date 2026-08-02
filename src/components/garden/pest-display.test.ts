import { describe, expect, it } from "vitest";
import { DISEASE_DEFINITIONS } from "@/domain/disease/disease-catalog";
import { PEST_DEFINITIONS } from "@/domain/pests/pest-catalog";
import { PREDATOR_DEFINITIONS } from "@/domain/pests/predator-catalog";
import {
  DISEASE_ICON,
  DISEASE_LABEL,
  PEST_ICON,
  PEST_LABEL,
  PREDATOR_ICON,
  PREDATOR_LABEL,
  bedPestPhrase,
  cellInfectionPhrase,
  diseaseSeverityBand,
  pestPressureBand,
} from "./pest-display";

// Regression guard for the exact bug class STRESS_DIAL_LABEL previously had
// (a missing `pestDisease` entry): derived from the live catalogs rather
// than a hardcoded key list, so a newly-added disease/pest/predator can't
// silently ship with no label or icon.
describe("catalog label/icon completeness", () => {
  it("has a real label and icon for every catalog disease", () => {
    for (const disease of DISEASE_DEFINITIONS) {
      expect(DISEASE_LABEL[disease.key]).toBeTypeOf("string");
      expect(DISEASE_LABEL[disease.key].length).toBeGreaterThan(0);
      expect(DISEASE_ICON[disease.key]).toBeDefined();
    }
  });

  it("has a real label and icon for every catalog pest", () => {
    for (const pest of PEST_DEFINITIONS) {
      expect(PEST_LABEL[pest.key]).toBeTypeOf("string");
      expect(PEST_LABEL[pest.key].length).toBeGreaterThan(0);
      expect(PEST_ICON[pest.key]).toBeDefined();
    }
  });

  it("has a real label and icon for every catalog predator", () => {
    for (const predator of PREDATOR_DEFINITIONS) {
      expect(PREDATOR_LABEL[predator.key]).toBeTypeOf("string");
      expect(PREDATOR_LABEL[predator.key].length).toBeGreaterThan(0);
      expect(PREDATOR_ICON[predator.key]).toBeDefined();
    }
  });
});

describe("diseaseSeverityBand", () => {
  it("bands mild/moderate/severe at the documented thresholds", () => {
    expect(diseaseSeverityBand(0.1)).toBe("mild");
    expect(diseaseSeverityBand(0.4)).toBe("moderate");
    expect(diseaseSeverityBand(0.7)).toBe("severe");
  });
});

describe("pestPressureBand", () => {
  it("bands low/moderate/high on the raw population scale, not a 0..1 fraction", () => {
    expect(pestPressureBand(0.5)).toBe("low");
    expect(pestPressureBand(1)).toBe("moderate");
    expect(pestPressureBand(3)).toBe("high");
  });
});

describe("cellInfectionPhrase", () => {
  it("returns null when every infection is below the display threshold", () => {
    expect(cellInfectionPhrase([{ diseaseKey: "blight", severity: 0.01 }])).toBeNull();
  });

  it("names the disease and severity band for an active infection", () => {
    expect(cellInfectionPhrase([{ diseaseKey: "blight", severity: 0.5 }])).toBe("moderate Blight");
  });
});

describe("bedPestPhrase", () => {
  it("returns null when every population is below the display threshold", () => {
    expect(bedPestPhrase([{ pestKey: "aphid", population: 0.05 }])).toBeNull();
  });

  it("names the pest and pressure band for an active population", () => {
    expect(bedPestPhrase([{ pestKey: "aphid", population: 3 }])).toBe("high Aphid pressure");
  });
});

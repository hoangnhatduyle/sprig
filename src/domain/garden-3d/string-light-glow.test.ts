import { describe, expect, it } from "vitest";
import { stringLightGlowForPhase } from "./string-light-glow";

describe("stringLightGlowForPhase", () => {
  it("is off during DAY", () => {
    const glow = stringLightGlowForPhase("DAY");
    expect(glow.visible).toBe(false);
    expect(glow.emissiveIntensity).toBe(0);
  });

  it("is visible with a positive emissive intensity during DUSK, NIGHT, and DAWN", () => {
    for (const phase of ["DUSK", "NIGHT", "DAWN"] as const) {
      const glow = stringLightGlowForPhase(phase);
      expect(glow.visible).toBe(true);
      expect(glow.emissiveIntensity).toBeGreaterThan(0);
    }
  });

  it("glows brightest at NIGHT, dimmer at the DUSK/DAWN transitions", () => {
    const night = stringLightGlowForPhase("NIGHT");
    const dusk = stringLightGlowForPhase("DUSK");
    const dawn = stringLightGlowForPhase("DAWN");
    expect(night.emissiveIntensity).toBeGreaterThan(dusk.emissiveIntensity);
    expect(night.emissiveIntensity).toBeGreaterThan(dawn.emissiveIntensity);
  });
});

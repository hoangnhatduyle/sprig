import { describe, expect, it } from "vitest";
import {
  COMPANION_EFFECT_ICON,
  COMPANION_EFFECT_KINDS,
  COMPANION_EFFECT_LABEL,
  cellCompanionEffectPhrase,
} from "./companion-effect-display";

// Regression guard mirroring stress-display.ts's STRESS_DIAL_KEYS test —
// every CompanionEffectKind must resolve to a label and an icon so a future
// 5th kind can't silently ship an unlabeled badge.
describe("COMPANION_EFFECT_KINDS completeness", () => {
  it("every kind has a label and an icon", () => {
    expect(COMPANION_EFFECT_KINDS).toHaveLength(4);
    for (const kind of COMPANION_EFFECT_KINDS) {
      expect(COMPANION_EFFECT_LABEL[kind]).toBeTruthy();
      expect(COMPANION_EFFECT_ICON[kind]).toBeTruthy();
    }
  });
});

describe("cellCompanionEffectPhrase", () => {
  it("returns null when there are no effects", () => {
    expect(cellCompanionEffectPhrase([])).toBeNull();
  });

  it("joins effect labels lowercased", () => {
    const phrase = cellCompanionEffectPhrase([
      { kind: "NITROGEN_FIX", sourceSpeciesKey: "pole-bean" },
      { kind: "POLLINATOR_BOOST", sourceSpeciesKey: "marigold" },
    ]);
    expect(phrase).toBe("nitrogen boost, pollinator boost");
  });
});

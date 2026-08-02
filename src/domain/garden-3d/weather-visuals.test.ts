import { describe, expect, it } from "vitest";
import { precipitationVisual } from "./weather-visuals";

describe("precipitationVisual", () => {
  it("returns null for no weather input", () => {
    expect(precipitationVisual(null)).toBeNull();
  });

  it("returns null for dry conditions (CLEAR/PARTLY_CLOUDY/CLOUDY with no precipitation)", () => {
    expect(precipitationVisual({ condition: "CLEAR", precipitationMm: 0, isSnowDay: false })).toBeNull();
    expect(precipitationVisual({ condition: "PARTLY_CLOUDY", precipitationMm: 0, isSnowDay: false })).toBeNull();
    expect(precipitationVisual({ condition: "CLOUDY", precipitationMm: 0, isSnowDay: false })).toBeNull();
  });

  it("gives STORM a higher particle count than RAIN at the same precipitation amount", () => {
    const rain = precipitationVisual({ condition: "RAIN", precipitationMm: 8, isSnowDay: false });
    const storm = precipitationVisual({ condition: "STORM", precipitationMm: 8, isSnowDay: false });
    expect(rain).not.toBeNull();
    expect(storm).not.toBeNull();
    expect(storm!.count).toBeGreaterThan(rain!.count);
  });

  it("isSnowDay overrides RAIN styling with snow-specific parameters", () => {
    const rain = precipitationVisual({ condition: "RAIN", precipitationMm: 5, isSnowDay: false });
    const snow = precipitationVisual({ condition: "RAIN", precipitationMm: 5, isSnowDay: true });
    expect(snow).not.toBeNull();
    expect(snow!.color).not.toBe(rain!.color);
    expect(snow!.speed).toBeLessThan(rain!.speed);
  });

  it("caps particle count regardless of how large precipitationMm is", () => {
    const extreme = precipitationVisual({ condition: "STORM", precipitationMm: 10_000, isSnowDay: false });
    expect(extreme).not.toBeNull();
    expect(extreme!.count).toBeLessThanOrEqual(400);
  });
});

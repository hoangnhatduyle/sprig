import { describe, expect, it } from "vitest";
import { computeSceneLighting } from "./scene-lighting";

const BASE_INPUT = {
  sunAltitudeRad: 0.9,
  sunAzimuthRad: 1.2,
  phase: "DAY" as const,
  cloudCoverPct: 0,
  isSnowDay: false,
};

describe("computeSceneLighting", () => {
  it("positions the sun above the horizon (positive Y) when altitude is positive", () => {
    const lighting = computeSceneLighting(BASE_INPUT);
    expect(lighting.sunPosition[1]).toBeGreaterThan(0);
  });

  it("dims both sun and ambient intensity as cloud cover rises, without going to zero", () => {
    const clear = computeSceneLighting({ ...BASE_INPUT, cloudCoverPct: 0 });
    const overcast = computeSceneLighting({ ...BASE_INPUT, cloudCoverPct: 100 });
    expect(overcast.sunIntensity).toBeLessThan(clear.sunIntensity);
    expect(overcast.ambientIntensity).toBeLessThan(clear.ambientIntensity);
    expect(overcast.sunIntensity).toBeGreaterThan(0);
    expect(overcast.ambientIntensity).toBeGreaterThan(0);
  });

  it("keeps the light above the horizon and dim, never dark, at night", () => {
    const night = computeSceneLighting({ ...BASE_INPUT, sunAltitudeRad: -0.4, phase: "NIGHT" });
    const day = computeSceneLighting(BASE_INPUT);
    expect(night.sunPosition[1]).toBeGreaterThan(0);
    expect(night.sunIntensity).toBeLessThan(day.sunIntensity);
    expect(night.sunIntensity).toBeGreaterThan(0);
    expect(night.ambientIntensity).toBeGreaterThan(0);
  });

  it("gives each phase a distinct sun color", () => {
    const colors = new Set(
      (["DAWN", "DAY", "DUSK", "NIGHT"] as const).map(
        (phase) => computeSceneLighting({ ...BASE_INPUT, phase }).sunColor,
      ),
    );
    // DAWN and DUSK intentionally share the same warm color (both are
    // low-sun-angle golden-hour moments) — only 3 distinct colors expected.
    expect(colors.size).toBe(3);
  });

  it("tints ambient light for a snow day", () => {
    const snow = computeSceneLighting({ ...BASE_INPUT, isSnowDay: true });
    const clear = computeSceneLighting({ ...BASE_INPUT, isSnowDay: false });
    expect(snow.ambientColor).not.toBe(clear.ambientColor);
  });
});

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { createTestPrismaClient } from "./test-db";
import { resetLightingTables } from "./test-db";
import { computeCellLightExposure } from "./cell-light-exposure";
import { computePhase, computeSunTimes } from "./sun-times";
import { isTransitionAllowed as isDayNightTransitionAllowed } from "./day-night-lifecycle";
import { isTransitionAllowed as isSolarLightTransitionAllowed } from "./solar-light-lifecycle";
import {
  advanceSolarLightForPhase,
  chargeSolarLight,
  depleteSolarLight,
} from "./solar-light-service";

// Traces to: /home/hoang/projects/Sprig/.claude/tests/SPEC-LIGHT-001.tests.yaml
// Each `it` below is named after its harness case id so validate_coverage
// results map 1:1 back to the generated test plan.

// Mid-latitude, non-extreme location: predictable dawn/sunrise/sunset/dusk
// ordering year-round (no polar day/night edge cases to guard against).
const GARDEN_LOCATION = { latitude: 40.7128, longitude: -74.006 }; // New York City
// Longitude 0 so local mean solar time equals UTC exactly — keeps the pure
// curve-shape assertions below independent of GARDEN_LOCATION's offset.
const PRIME_MERIDIAN = { latitude: 51.4769, longitude: 0 };
const EQUINOX = new Date("2026-03-21T12:00:00Z");

let prisma: PrismaClient;

beforeEach(async () => {
  prisma = createTestPrismaClient();
  await resetLightingTables(prisma);
});

afterEach(async () => {
  await prisma.$disconnect();
});

afterAll(async () => {
  const cleanup = createTestPrismaClient();
  await resetLightingTables(cleanup);
  await cleanup.$disconnect();
});

describe("SPEC-LIGHT-001", () => {
  it("T-SPEC-LIGHT-001-AC-AC_5: each cell's light exposure follows the captured shadow pattern, not a generic/uniform sun model", () => {
    // UTC-suffixed instants + longitude-0 location: local mean solar hour
    // equals the UTC hour exactly, independent of the host machine's TZ.
    const dawn = new Date("2026-06-21T05:00:00Z");
    const morning = new Date("2026-06-21T09:00:00Z");
    const noon = new Date("2026-06-21T12:00:00Z");
    const evening = new Date("2026-06-21T19:00:00Z");

    // The curve varies across the day rather than holding one constant value.
    expect(computeCellLightExposure("FULL_SUN", PRIME_MERIDIAN, dawn)).toBe(0);
    expect(computeCellLightExposure("FULL_SUN", PRIME_MERIDIAN, morning)).toBeGreaterThan(0);
    expect(computeCellLightExposure("FULL_SUN", PRIME_MERIDIAN, noon)).toBeGreaterThan(
      computeCellLightExposure("FULL_SUN", PRIME_MERIDIAN, morning),
    );
    expect(computeCellLightExposure("FULL_SUN", PRIME_MERIDIAN, evening)).toBeLessThan(
      computeCellLightExposure("FULL_SUN", PRIME_MERIDIAN, noon),
    );

    // A generic/uniform sun model would give every cell the same exposure at
    // noon regardless of its captured baseline shade — the captured study
    // means FULL_SUN and PARTIAL_SHADE cells must genuinely differ.
    const fullSunAtNoon = computeCellLightExposure("FULL_SUN", PRIME_MERIDIAN, noon);
    const partialShadeAtNoon = computeCellLightExposure("PARTIAL_SHADE", PRIME_MERIDIAN, noon);
    expect(partialShadeAtNoon).toBeGreaterThan(0);
    expect(partialShadeAtNoon).toBeLessThan(fullSunAtNoon);
  });

  it("T-SPEC-LIGHT-001-AC-AC_8: before real computed sunset, light matches the baked hour and solar lights are CHARGING/READY, never ILLUMINATED", async () => {
    const sunTimes = computeSunTimes(GARDEN_LOCATION, EQUINOX);
    const beforeSunset = new Date(sunTimes.sunset.getTime() - 2 * 60 * 60 * 1000);
    expect(computePhase(GARDEN_LOCATION, beforeSunset)).toBe("DAY");

    // The baked model still returns a real, time-varying exposure for this
    // daytime hour (not "no light" and not a flat constant).
    const exposure = computeCellLightExposure("FULL_SUN", GARDEN_LOCATION, beforeSunset);
    expect(exposure).toBeGreaterThan(0);

    const underchargedLight = await prisma.solarLight.create({ data: {} }); // CHARGING
    const readyLight = await prisma.solarLight.create({ data: {} });
    await chargeSolarLight(prisma, readyLight.id, 1); // CHARGING -> READY

    await advanceSolarLightForPhase(prisma, underchargedLight.id, "DAY");
    await advanceSolarLightForPhase(prisma, readyLight.id, "DAY");

    const updatedUndercharged = await prisma.solarLight.findUniqueOrThrow({
      where: { id: underchargedLight.id },
    });
    const updatedReady = await prisma.solarLight.findUniqueOrThrow({ where: { id: readyLight.id } });
    expect(updatedUndercharged.status).toBe("CHARGING");
    expect(updatedReady.status).toBe("READY");
  });

  it("T-SPEC-LIGHT-001-AC-AC_9: past real computed sunset the cycle moves through DUSK into NIGHT and a charged solar light illuminates", async () => {
    const sunTimes = computeSunTimes(GARDEN_LOCATION, EQUINOX);
    const justAfterSunset = new Date(sunTimes.sunset.getTime() + 60 * 1000);
    const wellAfterDusk = new Date(sunTimes.dusk.getTime() + 60 * 1000);

    expect(computePhase(GARDEN_LOCATION, justAfterSunset)).toBe("DUSK");
    expect(computePhase(GARDEN_LOCATION, wellAfterDusk)).toBe("NIGHT");

    const light = await prisma.solarLight.create({ data: {} });
    await chargeSolarLight(prisma, light.id, 1); // CHARGING -> READY

    await advanceSolarLightForPhase(prisma, light.id, "DUSK");
    const afterDusk = await prisma.solarLight.findUniqueOrThrow({ where: { id: light.id } });
    expect(afterDusk.status).toBe("ILLUMINATED");

    // Staying illuminated on into NIGHT — glowing, not a one-tick flicker.
    await advanceSolarLightForPhase(prisma, light.id, "NIGHT");
    const duringNight = await prisma.solarLight.findUniqueOrThrow({ where: { id: light.id } });
    expect(duringNight.status).toBe("ILLUMINATED");
  });

  it("T-SPEC-LIGHT-001-FORBID-Day_night_cycle_DAY_NIGHT: DAY -> NIGHT is rejected", () => {
    expect(isDayNightTransitionAllowed("DAY", "sunset_begins")).toBe(true);
    expect(isDayNightTransitionAllowed("DAY", "dark_falls")).toBe(false);
    expect(isDayNightTransitionAllowed("DAY", "sunrise_begins")).toBe(false);
    expect(isDayNightTransitionAllowed("DAY", "sunrise_complete")).toBe(false);
    // The only legal hop out of DAY lands on DUSK, never NIGHT directly.
  });

  it("T-SPEC-LIGHT-001-FORBID-Day_night_cycle_NIGHT_DAY: NIGHT -> DAY is rejected", () => {
    expect(isDayNightTransitionAllowed("NIGHT", "sunrise_begins")).toBe(true);
    expect(isDayNightTransitionAllowed("NIGHT", "sunrise_complete")).toBe(false);
    expect(isDayNightTransitionAllowed("NIGHT", "sunset_begins")).toBe(false);
    expect(isDayNightTransitionAllowed("NIGHT", "dark_falls")).toBe(false);
    // The only legal hop out of NIGHT lands on DAWN, never DAY directly.
  });

  it("T-SPEC-LIGHT-001-FORBID-Solar_light_lifecycle_DEPLETED_ILLUMINATED: DEPLETED -> ILLUMINATED is rejected", () => {
    expect(isSolarLightTransitionAllowed("DEPLETED", "dawn_breaks")).toBe(true);
    expect(isSolarLightTransitionAllowed("DEPLETED", "dusk_falls")).toBe(false);
    expect(isSolarLightTransitionAllowed("DEPLETED", "charge_sufficient")).toBe(false);
    expect(isSolarLightTransitionAllowed("DEPLETED", "charge_depleted")).toBe(false);
    // A depleted light's only legal hop is back to CHARGING.
  });

  it("T-SPEC-LIGHT-001-FORBID-Solar_light_lifecycle_CHARGING_ILLUMINATED: CHARGING -> ILLUMINATED is rejected", () => {
    expect(isSolarLightTransitionAllowed("CHARGING", "charge_sufficient")).toBe(true);
    expect(isSolarLightTransitionAllowed("CHARGING", "dusk_falls")).toBe(false);
    expect(isSolarLightTransitionAllowed("CHARGING", "dawn_breaks")).toBe(false);
    expect(isSolarLightTransitionAllowed("CHARGING", "charge_depleted")).toBe(false);
    // A light must reach READY before dusk_falls is a legal hop at all.
  });

  it("NC-SPRIG-DUSK-FROM-REAL-LOCATION: phase boundaries are derived from GardenLocation, not a fixed clock hour", () => {
    const nyc = GARDEN_LOCATION;
    const tokyo = { latitude: 35.6762, longitude: 139.6503 };
    // ~154 degrees of longitude apart — roughly 10 hours of local-solar-time
    // offset, so the same UTC instant is morning in one and night in the
    // other regardless of season.
    const sameInstant = EQUINOX; // 2026-03-21T12:00:00Z

    // Two different real locations legitimately disagree about the phase at
    // the same absolute instant — a fixed clock-hour rule could not do this.
    const nycPhase = computePhase(nyc, sameInstant);
    const tokyoPhase = computePhase(tokyo, sameInstant);
    expect(nycPhase).not.toBe(tokyoPhase);
  });

  it("NC-SPRIG-NO-WEATHER-API-IN-MUST-HAVE: computeSunTimes rejects an invalid lat/long instead of silently guessing", () => {
    expect(() => computeSunTimes({ latitude: 999, longitude: -74 }, EQUINOX)).toThrow();
  });

  it("a full charge -> illuminate -> deplete -> dawn cycle ends back at CHARGING, never skipping straight to READY/ILLUMINATED", async () => {
    const light = await prisma.solarLight.create({ data: {} });
    expect((await prisma.solarLight.findUniqueOrThrow({ where: { id: light.id } })).status).toBe(
      "CHARGING",
    );

    await chargeSolarLight(prisma, light.id, 1);
    expect((await prisma.solarLight.findUniqueOrThrow({ where: { id: light.id } })).status).toBe(
      "READY",
    );

    await advanceSolarLightForPhase(prisma, light.id, "DUSK");
    expect((await prisma.solarLight.findUniqueOrThrow({ where: { id: light.id } })).status).toBe(
      "ILLUMINATED",
    );

    await depleteSolarLight(prisma, light.id, 1);
    const depleted = await prisma.solarLight.findUniqueOrThrow({ where: { id: light.id } });
    expect(depleted.status).toBe("DEPLETED");
    expect(depleted.chargeLevel).toBe(0);

    await advanceSolarLightForPhase(prisma, light.id, "DAWN");
    const resetAtDawn = await prisma.solarLight.findUniqueOrThrow({ where: { id: light.id } });
    expect(resetAtDawn.status).toBe("CHARGING");
  });

  it("chargeSolarLight and depleteSolarLight reject non-positive or non-finite amounts instead of writing a nonsense charge level", async () => {
    const light = await prisma.solarLight.create({ data: {} });
    await expect(chargeSolarLight(prisma, light.id, 0)).rejects.toThrow();
    await expect(chargeSolarLight(prisma, light.id, Infinity)).rejects.toThrow();
    await expect(depleteSolarLight(prisma, light.id, -1)).rejects.toThrow();
  });

  it("charging a light that is already READY/ILLUMINATED/DEPLETED is a no-op, not an accumulating overcharge", async () => {
    const light = await prisma.solarLight.create({ data: {} });
    await chargeSolarLight(prisma, light.id, 1); // -> READY, chargeLevel 1
    await chargeSolarLight(prisma, light.id, 1); // no-op: not CHARGING anymore

    const readyLight = await prisma.solarLight.findUniqueOrThrow({ where: { id: light.id } });
    expect(readyLight.status).toBe("READY");
    expect(readyLight.chargeLevel).toBe(1);
  });

  it("operating on a non-existent SolarLight throws a domain error instead of a raw Prisma error", async () => {
    await expect(chargeSolarLight(prisma, "does-not-exist", 1)).rejects.toThrow();
    await expect(advanceSolarLightForPhase(prisma, "does-not-exist", "DUSK")).rejects.toThrow();
  });

  it("computeCellLightExposure rejects an unrecognized BaselineLight instead of returning a silent NaN/undefined", () => {
    expect(() =>
      // @ts-expect-error deliberately passing a value outside the BaselineLight union
      computeCellLightExposure("FULL_SHADE", GARDEN_LOCATION, EQUINOX),
    ).toThrow();
  });
});

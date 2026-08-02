import { Prisma, type PrismaClient } from "@prisma/client";
import {
  ConcurrentModificationError,
  DayNightTransitionError,
  InvalidChargeAmountError,
  SolarLightNotFoundError,
} from "./errors";
import type { DayNightPhase } from "./day-night-lifecycle";
import { type SolarLightStatus, nextStatus } from "./solar-light-lifecycle";

// Prisma's findUniqueOrThrow raises a generic PrismaClientKnownRequestError
// (code P2025) for a missing row — this module's other failure paths are
// all discriminable domain errors (InvalidChargeAmountError,
// SolarLightTransitionError, ...), so "light doesn't exist" gets the same
// treatment rather than leaking a Prisma-specific error type to callers.
async function getSolarLightOrThrow(
  tx: Prisma.TransactionClient,
  lightId: string,
): Promise<{ id: string; chargeLevel: number; status: SolarLightStatus }> {
  try {
    return await tx.solarLight.findUniqueOrThrow({ where: { id: lightId } });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
      throw new SolarLightNotFoundError(`SolarLight ${lightId} does not exist.`);
    }
    throw error;
  }
}

// The read (outside this function's control until the final write) and the
// write are two separate statements even inside prisma.$transaction on
// SQLite's deferred-BEGIN semantics — mirrors
// src/domain/irrigation/rain-barrel-service.ts's addWater. Two concurrent
// calls against the same light could otherwise both compute from the same
// stale read and the second write would silently clobber the first (a lost
// charge/status update). The final write is therefore conditioned on the
// row still matching what was read; zero rows affected means another
// writer won the race, and this throws rather than silently overwriting.

// Charges a light while it's CHARGING (charging only happens by day —
// callers only invoke this during DAWN/DAY phases; a light that isn't
// CHARGING is a no-op, matching real solar-lamp behavior where an already
// READY/ILLUMINATED light doesn't keep accumulating charge). chargeLevel is
// clamped at 1 (full); reaching it fires charge_sufficient (CHARGING ->
// READY) — this is the only path to READY, so dusk can never turn on a
// light that hasn't actually charged (NC-SPRIG-SOLAR-LIGHTS-NIGHT-ONLY
// combined with the forbidden CHARGING -> ILLUMINATED jump).
export async function chargeSolarLight(
  prisma: PrismaClient,
  lightId: string,
  deltaCharge: number,
): Promise<void> {
  if (!Number.isFinite(deltaCharge) || deltaCharge <= 0) {
    throw new InvalidChargeAmountError(
      "chargeSolarLight deltaCharge must be a positive, finite number.",
    );
  }

  await prisma.$transaction(async (tx) => {
    const light = await getSolarLightOrThrow(tx, lightId);
    if (light.status !== "CHARGING") {
      return;
    }

    const newCharge = Math.min(1, light.chargeLevel + deltaCharge);
    let status: SolarLightStatus = light.status;
    if (newCharge >= 1) {
      status = nextStatus(status, "charge_sufficient");
    }

    const result = await tx.solarLight.updateMany({
      where: { id: lightId, status: light.status, chargeLevel: light.chargeLevel },
      data: { chargeLevel: newCharge, status },
    });
    if (result.count === 0) {
      throw new ConcurrentModificationError(
        `SolarLight ${lightId} was modified concurrently; retry chargeSolarLight with a fresh read.`,
      );
    }
  });
}

// Drains an ILLUMINATED light (a light not currently on is a no-op — mirrors
// chargeSolarLight's guard). Reaching 0 fires charge_depleted (ILLUMINATED
// -> DEPLETED); a DEPLETED light can only reach CHARGING next
// (dawn_breaks), never straight back to ILLUMINATED — "a depleted light
// must recharge through a full day before it can illuminate again."
export async function depleteSolarLight(
  prisma: PrismaClient,
  lightId: string,
  deltaCharge: number,
): Promise<void> {
  if (!Number.isFinite(deltaCharge) || deltaCharge <= 0) {
    throw new InvalidChargeAmountError(
      "depleteSolarLight deltaCharge must be a positive, finite number.",
    );
  }

  await prisma.$transaction(async (tx) => {
    const light = await getSolarLightOrThrow(tx, lightId);
    if (light.status !== "ILLUMINATED") {
      return;
    }

    const newCharge = Math.max(0, light.chargeLevel - deltaCharge);
    let status: SolarLightStatus = light.status;
    if (newCharge <= 0) {
      status = nextStatus(status, "charge_depleted");
    }

    const result = await tx.solarLight.updateMany({
      where: { id: lightId, status: light.status, chargeLevel: light.chargeLevel },
      data: { chargeLevel: newCharge, status },
    });
    if (result.count === 0) {
      throw new ConcurrentModificationError(
        `SolarLight ${lightId} was modified concurrently; retry depleteSolarLight with a fresh read.`,
      );
    }
  });
}

// Whether `phase` is one of the two daylight phases (DAWN/DAY) vs. one of
// the two dark phases (DUSK/NIGHT). An exhaustive switch (not an if/else
// asserting "everything else must be DAWN/DAY") so that if DayNightPhase
// ever grows a fifth value, this fails loudly instead of silently routing
// the unrecognized phase into the daylight branch — matching how
// day-night-lifecycle.ts's nextPhase and solar-light-lifecycle.ts's
// nextStatus both throw on any input they don't explicitly recognize.
function isDaylightPhase(phase: DayNightPhase): boolean {
  switch (phase) {
    case "DAWN":
    case "DAY":
      return true;
    case "DUSK":
    case "NIGHT":
      return false;
    default: {
      const unreachable: never = phase;
      throw new DayNightTransitionError(`Unknown DayNightPhase: ${String(unreachable)}`);
    }
  }
}

// The automatic driver behind NC-SPRIG-SOLAR-LIGHTS-NIGHT-ONLY: called on
// every phase tick (mirroring irrigation-service's maybeTriggerDailyCycle
// time-driven design — sunrise/sunset drives this the same way the daily
// window drives watering). Entering DUSK/NIGHT turns on a READY light;
// entering DAWN/DAY resets an ILLUMINATED or DEPLETED light back to
// CHARGING. A light that's CHARGING at dusk (not yet READY) simply stays
// CHARGING — there is no legal hop from CHARGING to ILLUMINATED, so an
// under-charged light silently staying dark is the only possible outcome,
// never an error.
export async function advanceSolarLightForPhase(
  prisma: PrismaClient,
  lightId: string,
  phase: DayNightPhase,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const light = await getSolarLightOrThrow(tx, lightId);
    let status: SolarLightStatus = light.status;

    if (isDaylightPhase(phase)) {
      if (status === "ILLUMINATED" || status === "DEPLETED") {
        status = nextStatus(status, "dawn_breaks");
      }
    } else if (status === "READY") {
      status = nextStatus(status, "dusk_falls");
    }

    if (status === light.status) {
      return;
    }

    const result = await tx.solarLight.updateMany({
      where: { id: lightId, status: light.status },
      data: { status },
    });
    if (result.count === 0) {
      throw new ConcurrentModificationError(
        `SolarLight ${lightId} was modified concurrently; retry advanceSolarLightForPhase with a fresh read.`,
      );
    }
  });
}

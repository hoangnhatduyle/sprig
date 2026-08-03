import type { PrismaClient } from "@prisma/client";
import {
  ConcurrentModificationError,
  InsufficientWaterError,
  InvalidCatchmentAreaError,
  InvalidWaterAmountError,
} from "./errors";
import { type RainBarrelStatus, nextStatus } from "./rain-barrel-lifecycle";

// Standard rainfall-harvesting conversion: 1 sq ft of catchment under 1 inch
// of rain yields ~0.623 gallons (62.4 lb/ft^3 water density / 8.34 lb/gal,
// per inch depth over a square foot). precipitationMm from the weather
// provider is converted to inches first.
const MM_PER_INCH = 25.4;
const GALLONS_PER_SQFT_PER_INCH = 0.623;

// Adds water to a barrel, decomposed into the individually-legal hops of the
// "Rain barrel water level" state machine (EMPTY -[add_water]-> PARTIAL
// -[reach_capacity]-> FULL -[add_water]-> OVERFLOWING) rather than computing
// a final status directly from the gallon math. That decomposition is what
// makes NC-SPRIG-BARREL-CAPACITY-CAP's overflow event structurally
// unavoidable: there is no code path that reaches OVERFLOWING without first
// passing through the reach_capacity hop, matching the spec's forbidden
// EMPTY -> OVERFLOWING jump.
//
// currentGallons is clamped at capacityGallons — the excess is never stored
// on the barrel itself, only recorded as a dated OVERFLOW journal entry
// (RainBarrelEvent), so it's never silently discarded (per the NC) nor
// silently double-counted into currentGallons.
//
// The read (outside this function's control until the final write) and the
// write are two separate statements even inside prisma.$transaction on
// SQLite's deferred-BEGIN semantics, so two concurrent addWater calls on the
// same barrel could otherwise both compute from the same stale read and the
// second write would silently clobber the first (a lost REACH_CAPACITY or
// OVERFLOW event — exactly the silent-loss NC-SPRIG-BARREL-CAPACITY-CAP
// forbids). The final update is therefore conditioned on the row still
// matching what was read; zero rows affected means another writer won the
// race, and this throws rather than silently overwriting.
export async function addWater(
  prisma: PrismaClient,
  barrelId: string,
  amountGallons: number,
): Promise<void> {
  if (!Number.isFinite(amountGallons) || amountGallons <= 0) {
    throw new InvalidWaterAmountError(
      "addWater amount must be a positive, finite number of gallons.",
    );
  }

  await prisma.$transaction(async (tx) => {
    const barrel = await tx.rainBarrel.findUniqueOrThrow({ where: { id: barrelId } });

    let status = barrel.status as RainBarrelStatus;
    const remainingToCapacity = barrel.capacityGallons - barrel.currentGallons;
    const events: { eventType: "ADD_WATER" | "REACH_CAPACITY" | "OVERFLOW"; amountGallons: number }[] =
      [];
    let newGallons: number;

    if (amountGallons < remainingToCapacity) {
      // Stays below capacity. EMPTY must still hop through PARTIAL even when
      // it's the barrel's very first drop of water — there is no direct
      // EMPTY -> FULL/OVERFLOWING edge in the transition table. From PARTIAL
      // this is the self-loop PARTIAL -[add_water]-> PARTIAL.
      status = nextStatus(status, "add_water");
      events.push({ eventType: "ADD_WATER", amountGallons });
      newGallons = barrel.currentGallons + amountGallons;
    } else {
      // Reaches or exceeds capacity. Hop to FULL first (unless already
      // FULL/OVERFLOWING) — this is the reach_capacity event that
      // structurally stands between any starting state and OVERFLOWING.
      if (status === "EMPTY") {
        status = nextStatus(status, "add_water"); // EMPTY -> PARTIAL
      }
      if (status === "PARTIAL") {
        status = nextStatus(status, "reach_capacity"); // PARTIAL -> FULL
        events.push({ eventType: "REACH_CAPACITY", amountGallons: remainingToCapacity });
      }

      const overflow = amountGallons - remainingToCapacity;
      if (overflow > 0) {
        if (status === "FULL") {
          status = nextStatus(status, "add_water"); // FULL -> OVERFLOWING
        }
        // If status was already OVERFLOWING (barrel already over capacity
        // and more water arrives), there's no further hop to make — it just
        // logs more overflow.
        events.push({ eventType: "OVERFLOW", amountGallons: overflow });
      }
      newGallons = barrel.capacityGallons;
    }

    await tx.rainBarrelEvent.createMany({
      data: events.map((e) => ({ barrelId, eventType: e.eventType, amountGallons: e.amountGallons })),
    });

    const result = await tx.rainBarrel.updateMany({
      where: { id: barrelId, status: barrel.status, currentGallons: barrel.currentGallons },
      data: { status, currentGallons: newGallons },
    });
    if (result.count === 0) {
      throw new ConcurrentModificationError(
        `RainBarrel ${barrelId} was modified concurrently; retry addWater with a fresh read.`,
      );
    }
  });
}

// Mirrors addWater's decomposition, but draining down instead of filling up.
// draw_water's own self-loop (PARTIAL -> PARTIAL) covers any draw that
// doesn't fully empty the barrel; reaching exactly zero uses the dedicated
// reach_empty edge, and OVERFLOWING settles to FULL first — see
// rain-barrel-lifecycle.ts for why each of these is a distinct event rather
// than an amount-conditional branch on draw_water alone.
export async function drawWater(
  prisma: PrismaClient,
  barrelId: string,
  amountGallons: number,
): Promise<void> {
  if (!Number.isFinite(amountGallons) || amountGallons <= 0) {
    throw new InvalidWaterAmountError(
      "drawWater amount must be a positive, finite number of gallons.",
    );
  }

  await prisma.$transaction(async (tx) => {
    const barrel = await tx.rainBarrel.findUniqueOrThrow({ where: { id: barrelId } });

    if (amountGallons > barrel.currentGallons) {
      throw new InsufficientWaterError(
        `RainBarrel ${barrelId} only holds ${barrel.currentGallons} gallons; cannot draw ${amountGallons}.`,
      );
    }

    let status = barrel.status as RainBarrelStatus;
    if (status === "OVERFLOWING") {
      status = nextStatus(status, "draw_water"); // OVERFLOWING -> FULL
    }

    const newGallons = barrel.currentGallons - amountGallons;

    if (newGallons > 0) {
      status = nextStatus(status, "draw_water"); // FULL -> PARTIAL, or PARTIAL -> PARTIAL
    } else {
      if (status === "FULL") {
        status = nextStatus(status, "draw_water"); // FULL -> PARTIAL
      }
      status = nextStatus(status, "reach_empty"); // PARTIAL -> EMPTY
    }

    await tx.rainBarrelEvent.create({
      data: { barrelId, eventType: "DRAW_WATER", amountGallons },
    });

    const result = await tx.rainBarrel.updateMany({
      where: { id: barrelId, status: barrel.status, currentGallons: barrel.currentGallons },
      data: { status, currentGallons: newGallons },
    });
    if (result.count === 0) {
      throw new ConcurrentModificationError(
        `RainBarrel ${barrelId} was modified concurrently; retry drawWater with a fresh read.`,
      );
    }
  });
}

// The daily "fill from real rain" entry point: converts the day's real
// precipitation into gallons collected over this barrel's catchment area and
// funnels it through addWater's own overflow/capacity handling. When no rain
// fell and the barrel was left OVERFLOWING from a prior day, settles it back
// to FULL via the rain_stop edge — nothing else in the codebase currently
// exercises that transition.
//
// Takes a barrelId (not a preloaded row) and reads fresh state itself,
// because the caller (catch-up-service.ts's per-barrel loop) invokes this
// once per simulated day — a preloaded row would go stale after the first
// day's addWater() call and mis-evaluate the OVERFLOWING check on day two.
export async function applyDailyRainfall(
  prisma: PrismaClient,
  barrelId: string,
  precipitationMm: number,
): Promise<void> {
  const barrel = await prisma.rainBarrel.findUniqueOrThrow({ where: { id: barrelId } });
  const gallonsCollected =
    (precipitationMm / MM_PER_INCH) * barrel.catchmentAreaSqFt * GALLONS_PER_SQFT_PER_INCH;

  if (gallonsCollected > 0) {
    await addWater(prisma, barrel.id, gallonsCollected);
    return;
  }

  if (barrel.status !== "OVERFLOWING") {
    return;
  }

  await prisma.$transaction(async (tx) => {
    const current = await tx.rainBarrel.findUniqueOrThrow({ where: { id: barrel.id } });
    if (current.status !== "OVERFLOWING") {
      return; // already settled by a concurrent call
    }

    await tx.rainBarrelEvent.create({
      data: { barrelId: barrel.id, eventType: "RAIN_STOP", amountGallons: 0 },
    });

    const result = await tx.rainBarrel.updateMany({
      where: { id: barrel.id, status: "OVERFLOWING" },
      data: { status: nextStatus("OVERFLOWING", "rain_stop") },
    });
    if (result.count === 0) {
      throw new ConcurrentModificationError(
        `RainBarrel ${barrel.id} was modified concurrently; retry applyDailyRainfall with a fresh read.`,
      );
    }
  });
}

// Manual, per-barrel input — there's no house/roof modeled in the 3D scene
// (confirmed while planning this feature), so catchment area can never be
// derived geometrically and has to be a number the user sets themselves
// based on which real downspout feeds each barrel.
export async function updateCatchmentArea(
  prisma: PrismaClient,
  barrelId: string,
  catchmentAreaSqFt: number,
): Promise<void> {
  if (!Number.isFinite(catchmentAreaSqFt) || catchmentAreaSqFt <= 0) {
    throw new InvalidCatchmentAreaError(
      "catchmentAreaSqFt must be a positive, finite number of square feet.",
    );
  }
  await prisma.rainBarrel.update({
    where: { id: barrelId },
    data: { catchmentAreaSqFt },
  });
}

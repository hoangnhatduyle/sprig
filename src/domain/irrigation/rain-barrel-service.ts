import type { PrismaClient } from "@prisma/client";
import { ConcurrentModificationError, InvalidWaterAmountError } from "./errors";
import { type RainBarrelStatus, nextStatus } from "./rain-barrel-lifecycle";

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

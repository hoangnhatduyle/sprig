import type { PrismaClient } from "@prisma/client";
import { InvalidClockRateError } from "./errors";

// A sane upper bound on how fast simulated time can run: high enough to let
// a whole season play out in a short real session (1000x means one real
// minute is >16 simulated hours), low enough that a single accidental extra
// zero doesn't fast-forward a plant through its entire life the moment the
// page loads. Not derived from any physical constant — a product/balancing
// choice (see the architecture doc's §15), adjustable if it turns out wrong.
const MAX_CLOCK_RATE = 1000;

export interface SimClockState {
  simTime: Date;
  rate: number;
}

// The clock is ALWAYS derived from the most recent epoch, never advanced by
// a background process — this is what lets accelerated simulated time run
// on Next.js server actions + SQLite with no worker/cron (see the
// architecture doc's §2). No epoch yet means the garden's clock has never
// been started: simulated time defaults to tracking real time 1:1 rather
// than throwing, so every other read (weather, growth) has *something* to
// derive from before a user ever touches the clock control.
export async function getCurrentSimTime(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<SimClockState> {
  const epoch = await prisma.simClockEpoch.findFirst({ orderBy: { realAnchorAt: "desc" } });
  if (!epoch) {
    return { simTime: now, rate: 1 };
  }
  const elapsedRealMs = now.getTime() - epoch.realAnchorAt.getTime();
  const simTime = new Date(epoch.simAnchorAt.getTime() + elapsedRealMs * epoch.rate);
  return { simTime, rate: epoch.rate };
}

// Inserts a new breakpoint rather than mutating the last one (append-only,
// mirroring GridCellEvent/BedRenovation elsewhere in this codebase): the
// simulated time AT `at` is captured as the new anchor, so continuity holds
// across a rate change — only what happens *after* `at` runs at the new
// rate. rate === 0 is a legal, explicit "pause" (simTime stops advancing
// until the next epoch), not a special case.
export async function setClockRate(
  prisma: PrismaClient,
  rate: number,
  at: Date = new Date(),
): Promise<SimClockState> {
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_CLOCK_RATE) {
    throw new InvalidClockRateError(
      `Clock rate ${rate} must be a finite number between 0 and ${MAX_CLOCK_RATE}.`,
    );
  }
  const current = await getCurrentSimTime(prisma, at);
  await prisma.simClockEpoch.create({
    data: { realAnchorAt: at, simAnchorAt: current.simTime, rate },
  });
  return { simTime: current.simTime, rate };
}

// Unlike setClockRate, this deliberately breaks continuity: simAnchorAt is
// pinned to `at` (real now) instead of wherever simTime currently sits, so a
// garden that's drifted away from real time (fast-forwarded ahead, or left
// paused in the past) snaps back to tracking real time from this moment on.
// The rate itself is left as-is — this button only answers "what time is it
// really", not "how fast should time move".
export async function resetSimClockToNow(
  prisma: PrismaClient,
  at: Date = new Date(),
): Promise<SimClockState> {
  const current = await getCurrentSimTime(prisma, at);
  await prisma.simClockEpoch.create({
    data: { realAnchorAt: at, simAnchorAt: at, rate: current.rate },
  });
  return { simTime: at, rate: current.rate };
}

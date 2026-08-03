import { GardenView } from "@/components/garden/GardenView";
import { getGardenSnapshot } from "@/domain/grid/grid-cell-service";
import { catchUpGrowth } from "@/domain/growth/catch-up-service";
import { getGardenJournal } from "@/domain/journal/journal-service";
import { getInventorySnapshot } from "@/domain/plant-catalog/inventory-service";
import { prisma } from "@/lib/prisma";

// This page runs a write (catchUpGrowth) on every load, so it must never be
// statically prerendered — build-time execution would run that write against
// whatever DATABASE_URL the build environment sees, and fail outright if
// migrations haven't been applied there yet (as happened on Vercel).
export const dynamic = "force-dynamic";

export default async function Home() {
  // Mirrors refreshGardenSnapshotAction/refreshWorkspaceAction's own
  // catch-up-before-read order (src/app/actions.ts) so first paint never
  // shows a pre-simulation state — without this, environment.weather would
  // be null until the user's first click-triggered refresh.
  await catchUpGrowth(prisma);
  const [snapshot, inventory, journal] = await Promise.all([
    getGardenSnapshot(prisma),
    getInventorySnapshot(prisma),
    getGardenJournal(prisma),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-[112rem] flex-col gap-8 px-4 py-6 sm:px-5 sm:py-8 lg:px-6 lg:py-10 xl:px-10 2xl:px-4">
      <header className="border-b pb-5 sm:pb-6" style={{ borderColor: "var(--color-border)" }}>
        <p
          className="mb-1 text-xs font-semibold uppercase tracking-[0.2em]"
          style={{ color: "var(--color-clay-strong)" }}
        >
          Garden planner
        </p>
        <h1
          className="text-[clamp(2.5rem,5vw,4rem)] leading-none"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
        >
          Sprig
        </h1>
        <p className="mt-3 max-w-prose text-sm sm:text-base" style={{ color: "var(--color-text-muted)" }}>
          Manage your seeds, drag plants into a bed, and record every harvest.
        </p>
      </header>
      <GardenView
        initialBeds={snapshot.beds}
        initialEnvironment={snapshot.environment}
        initialPlants={inventory.seeds}
        initialInventory={inventory}
        initialJournal={journal}
      />
    </main>
  );
}

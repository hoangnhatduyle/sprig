// Pesticide and predator-release human actions (architecture doc §12).
// Bed-scoped, not cell-scoped — PestPopulation/PredatorPopulation are
// per-bed state (§10: "population-based per bed, not individual agents"),
// so these actions target the same granularity the population model
// already uses.

import type { PrismaClient } from "@prisma/client";
import { getPestDefinition } from "./pest-catalog";
import { getPredatorDefinition } from "./predator-catalog";
import { InvalidPestActionAmountError, UnknownPestKeyError, UnknownPredatorKeyError } from "./errors";

// A single application knocks the targeted pest down hard but not to zero —
// same "recoverable, not instant" treatment as fungicide/weeding.
const PESTICIDE_TARGETED_REDUCTION_FRACTION = 0.75;
// Broad-spectrum options also suppress predators — the architecture doc's
// own "real, meaningful tradeoff" (§12): killing the pest AND the thing
// that was eating it.
const PESTICIDE_BROAD_SPECTRUM_PREDATOR_REDUCTION_FRACTION = 0.4;
const MAX_PREDATOR_RELEASE_AMOUNT = 5;

export interface ApplyPesticideInput {
  bedId: string;
  pestKey: string;
  broadSpectrum: boolean;
}

export async function applyPesticideToBed(prisma: PrismaClient, input: ApplyPesticideInput): Promise<void> {
  const pest = getPestDefinition(input.pestKey);
  if (!pest) {
    throw new UnknownPestKeyError(`Unknown pest key "${input.pestKey}".`);
  }

  const pestRow = await prisma.pestPopulation.findUnique({
    where: { bedId_pestKey: { bedId: input.bedId, pestKey: pest.key } },
  });
  if (pestRow) {
    await prisma.pestPopulation.update({
      where: { id: pestRow.id },
      data: { population: Math.max(0, pestRow.population * (1 - PESTICIDE_TARGETED_REDUCTION_FRACTION)) },
    });
  }

  if (input.broadSpectrum) {
    const predatorRows = await prisma.predatorPopulation.findMany({ where: { bedId: input.bedId } });
    for (const row of predatorRows) {
      await prisma.predatorPopulation.update({
        where: { id: row.id },
        data: { population: Math.max(0, row.population * (1 - PESTICIDE_BROAD_SPECTRUM_PREDATOR_REDUCTION_FRACTION)) },
      });
    }
  }

  // Bed-scoped (cellId: null), same granularity as PestPopulation/
  // PredatorPopulation above — purely for the Journal read model
  // (src/domain/journal/journal-service.ts).
  await prisma.careActionEvent.create({
    data: {
      bedId: input.bedId,
      cellId: null,
      actionType: "PESTICIDE",
      detail: JSON.stringify({ pestKey: input.pestKey, broadSpectrum: input.broadSpectrum }),
    },
  });
}

export interface ReleasePredatorsInput {
  bedId: string;
  predatorKey: string;
  amount: number;
}

// "Release ladybugs" (architecture doc §10/§12) — a direct, bounded
// population addition, the predator-side counterpart to fertilizing's
// bounded N/P/K addition (care-actions-service.ts's
// MAX_FERTILIZER_AMOUNT_PER_NUTRIENT precedent).
export async function releasePredatorsToBed(prisma: PrismaClient, input: ReleasePredatorsInput): Promise<void> {
  const predator = getPredatorDefinition(input.predatorKey);
  if (!predator) {
    throw new UnknownPredatorKeyError(`Unknown predator key "${input.predatorKey}".`);
  }
  if (!Number.isFinite(input.amount) || input.amount < 0 || input.amount > MAX_PREDATOR_RELEASE_AMOUNT) {
    throw new InvalidPestActionAmountError(
      `Predator release amount ${input.amount} must be a finite number between 0 and ${MAX_PREDATOR_RELEASE_AMOUNT}.`,
    );
  }

  await prisma.predatorPopulation.upsert({
    where: { bedId_predatorKey: { bedId: input.bedId, predatorKey: predator.key } },
    update: { population: { increment: input.amount } },
    create: { bedId: input.bedId, predatorKey: predator.key, population: input.amount },
  });

  await prisma.careActionEvent.create({
    data: {
      bedId: input.bedId,
      cellId: null,
      actionType: "PREDATOR_RELEASE",
      detail: JSON.stringify({ predatorKey: input.predatorKey, amount: input.amount }),
    },
  });
}

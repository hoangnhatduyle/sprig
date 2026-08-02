// Human actions that directly touch a cell's soil state — mulching,
// composting, fertilizing (architecture doc §12). Same shape as
// bed-condition-override-service.ts: bounded inputs (assertValid*), a thin
// DB read-modify-write against CellEnvironmentState (a latest-computed cache
// the growth engine also mutates in place every simulated day — never a
// history of its own). Each action additionally writes a CareActionEvent row
// in the same transaction, purely for the Journal read model
// (src/domain/journal/journal-service.ts) — that table is the durable
// "what happened and when" record; CellEnvironmentState stays current-state-only.

import type { CellEnvironmentState, PrismaClient } from "@prisma/client";
import { RESIDUE_POOL_CEILING } from "./nutrient-service";
import { InvalidCareActionAmountError } from "./errors";

const MAX_MULCH_DEPTH_MM = 150;
const MAX_COMPOST_AMOUNT = 2;
const MAX_FERTILIZER_AMOUNT_PER_NUTRIENT = 0.5;
// A single weeding pass never claims 100% — some root fragments/seed bank
// remain, matching how a gardener actually experiences weeding (it knocks
// pressure down a lot, it doesn't guarantee zero regrowth).
const WEEDING_REDUCTION_FRACTION = 0.85;

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function assertInRange(label: string, value: number, min: number, max: number): void {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new InvalidCareActionAmountError(`${label} ${value} must be a finite number between ${min} and ${max}.`);
  }
}

// (bedId, column, row) is how the UI addresses a cell (CellPicker never
// sees a raw cellId) — the same CellLookup shape grid-cell-service.ts's
// germinate/grow/harvest already use, resolved to the real cellId here.
export interface CellLookup {
  bedId: string;
  column: number;
  row: number;
}

// Every care action needs a CellEnvironmentState row to mutate, but a
// just-planted cell may not have one yet (the growth engine creates it
// lazily on first catch-up, catch-up-service.ts) — self-healing, same
// pattern as soil-profile-service.ts's getOrCreateSoilProfile.
async function getOrCreateEnvironmentState(prisma: PrismaClient, lookup: CellLookup): Promise<CellEnvironmentState> {
  const cell = await prisma.gridCell.findUniqueOrThrow({
    where: { bedId_column_row: { bedId: lookup.bedId, column: lookup.column, row: lookup.row } },
  });
  const existing = await prisma.cellEnvironmentState.findUnique({ where: { cellId: cell.id } });
  if (existing) {
    return existing;
  }
  return prisma.cellEnvironmentState.create({ data: { cellId: cell.id } });
}

export interface ApplyMulchInput extends CellLookup {
  depthMm: number;
}

// Sets (not accumulates) the cell's mulch depth — re-mulching to a given
// depth is idempotent, matching how a gardener actually thinks about it
// ("top up to 2 inches"), not a running total.
export async function applyMulchToCell(prisma: PrismaClient, input: ApplyMulchInput): Promise<CellEnvironmentState> {
  assertInRange("Mulch depth (mm)", input.depthMm, 0, MAX_MULCH_DEPTH_MM);
  const state = await getOrCreateEnvironmentState(prisma, input);
  const [updated] = await prisma.$transaction([
    prisma.cellEnvironmentState.update({
      where: { cellId: state.cellId },
      data: { mulchDepthMm: input.depthMm },
    }),
    prisma.careActionEvent.create({
      data: {
        bedId: input.bedId,
        cellId: state.cellId,
        actionType: "MULCH",
        detail: JSON.stringify({ depthMm: input.depthMm }),
      },
    }),
  ]);
  return updated;
}

export interface ApplyCompostInput extends CellLookup {
  amount: number;
}

// Compost is always slow-release: it joins the shared residue pool that
// nutrient-service.ts's decomposition step converts to available N/P/K over
// time — never a direct pool addition (that's what SYNTHETIC fertilizer is
// for, applyFertilizerToCell below).
export async function applyCompostToCell(prisma: PrismaClient, input: ApplyCompostInput): Promise<CellEnvironmentState> {
  assertInRange("Compost amount", input.amount, 0, MAX_COMPOST_AMOUNT);
  const state = await getOrCreateEnvironmentState(prisma, input);
  const residueOrganicMatterPool = Math.min(RESIDUE_POOL_CEILING, state.residueOrganicMatterPool + input.amount);
  const [updated] = await prisma.$transaction([
    prisma.cellEnvironmentState.update({
      where: { cellId: state.cellId },
      data: { residueOrganicMatterPool },
    }),
    prisma.careActionEvent.create({
      data: {
        bedId: input.bedId,
        cellId: state.cellId,
        actionType: "COMPOST",
        detail: JSON.stringify({ amount: input.amount }),
      },
    }),
  ]);
  return updated;
}

export type FertilizerKind = "SYNTHETIC" | "ORGANIC";

export interface ApplyFertilizerInput extends CellLookup {
  kind: FertilizerKind;
  n: number;
  p: number;
  k: number;
}

// The one real mechanical difference the architecture doc calls out (§7)
// between synthetic and organic fertilizer: SYNTHETIC adds directly to the
// N/P/K pools (fast-acting, and therefore exposed to the very next
// drainage event's leaching in nutrient-service.ts — "heavy rain right
// after fertilizing wastes it"). ORGANIC instead joins the same slow-release
// residue pool compost uses; its specific N/P/K split isn't separately
// tracked once it's in the shared residue pool (a documented Phase 2
// simplification), so n/p/k are summed into one residue addition.
export async function applyFertilizerToCell(
  prisma: PrismaClient,
  input: ApplyFertilizerInput,
): Promise<CellEnvironmentState> {
  assertInRange("Nitrogen amount", input.n, 0, MAX_FERTILIZER_AMOUNT_PER_NUTRIENT);
  assertInRange("Phosphorus amount", input.p, 0, MAX_FERTILIZER_AMOUNT_PER_NUTRIENT);
  assertInRange("Potassium amount", input.k, 0, MAX_FERTILIZER_AMOUNT_PER_NUTRIENT);
  const state = await getOrCreateEnvironmentState(prisma, input);
  const careActionEvent = prisma.careActionEvent.create({
    data: {
      bedId: input.bedId,
      cellId: state.cellId,
      actionType: "FERTILIZER",
      detail: JSON.stringify({ kind: input.kind, n: input.n, p: input.p, k: input.k }),
    },
  });

  if (input.kind === "ORGANIC") {
    const residueOrganicMatterPool = Math.min(
      RESIDUE_POOL_CEILING,
      state.residueOrganicMatterPool + input.n + input.p + input.k,
    );
    const [updated] = await prisma.$transaction([
      prisma.cellEnvironmentState.update({
        where: { cellId: state.cellId },
        data: { residueOrganicMatterPool },
      }),
      careActionEvent,
    ]);
    return updated;
  }

  const [updated] = await prisma.$transaction([
    prisma.cellEnvironmentState.update({
      where: { cellId: state.cellId },
      data: {
        nitrogenPoolFraction: clamp01(state.nitrogenPoolFraction + input.n),
        phosphorusPoolFraction: clamp01(state.phosphorusPoolFraction + input.p),
        potassiumPoolFraction: clamp01(state.potassiumPoolFraction + input.k),
      },
    }),
    careActionEvent,
  ]);
  return updated;
}

// Weeding (architecture doc §12, Phase 3): knocks down a cell's
// weedPressureFraction (weed-pressure-service.ts) by a fixed fraction
// rather than zeroing it — see WEEDING_REDUCTION_FRACTION above.
export async function applyWeedingToCell(prisma: PrismaClient, input: CellLookup): Promise<CellEnvironmentState> {
  const state = await getOrCreateEnvironmentState(prisma, input);
  const [updated] = await prisma.$transaction([
    prisma.cellEnvironmentState.update({
      where: { cellId: state.cellId },
      data: { weedPressureFraction: clamp01(state.weedPressureFraction * (1 - WEEDING_REDUCTION_FRACTION)) },
    }),
    prisma.careActionEvent.create({
      data: { bedId: input.bedId, cellId: state.cellId, actionType: "WEEDING", detail: null },
    }),
  ]);
  return updated;
}

"use client";

// Multi-cell bulk actions: plant/water/weed/change-stage/harvest/note across
// every currently selected cell in one go. Reuses the existing single-cell
// server actions (assignInventoryPlantAction, waterCellAction, etc.) looped
// via Promise.allSettled instead of a new batch endpoint — each of those is
// already a pure, independent per-cell mutation with no cross-cell
// invariant, matching the "one core function, many callers" precedent the
// rest of this codebase already follows (see daily-step-orchestrator.ts).
// Partial failure is surfaced as a summary message, not an all-or-nothing
// rollback, since these are independent per-cell writes.

import { useState } from "react";
import {
  applyWeedingAction,
  assignInventoryPlantAction,
  createJournalNoteAction,
  overridePlantingStageAction,
  recordHarvestAction,
  waterCellAction,
  type ActionResult,
} from "@/app/actions";
import { plantName } from "./plant-lookup";
import { PHENOLOGY_LABEL } from "./status-display";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import type { PlantOption } from "./types";

// Mirrors stage-override-service.ts's OVERRIDABLE_STAGES (SENESCENT/DEAD are
// terminal states the growth engine reaches on its own, never a manual
// target) — same duplication CellPicker.tsx's own local copy already
// accepts rather than reaching into a domain-internal constant.
const OVERRIDABLE_STAGES = ["GERMINATING", "VEGETATIVE", "FLOWERING", "FRUITING", "MATURE"] as const;

export interface BulkTarget {
  bedId: string;
  bedName: string;
  column: number;
  row: number;
  primaryCellPlantingId: string | null;
}

interface BulkActionBarProps {
  targets: BulkTarget[];
  plants: PlantOption[];
  disabled: boolean;
  onDone: (message: string) => Promise<void> | void;
}

type BulkActionKind = "plant" | "water" | "weed" | "stage" | "harvest" | "note";

const ACTION_LABEL: Record<BulkActionKind, string> = {
  plant: "Plant",
  water: "Water",
  weed: "Weed",
  stage: "Growth stage",
  harvest: "Harvest",
  note: "Journal note",
};

function summarize(label: string, results: PromiseSettledResult<ActionResult>[]): string {
  let succeeded = 0;
  const errors: string[] = [];
  for (const result of results) {
    if (result.status === "fulfilled" && result.value.ok) {
      succeeded += 1;
    } else {
      errors.push(result.status === "fulfilled" ? (result.value.error ?? "failed") : "failed");
    }
  }
  const failed = results.length - succeeded;
  if (failed === 0) {
    return `${label}: ${succeeded}/${results.length} cell${results.length === 1 ? "" : "s"} updated.`;
  }
  const uniqueErrors = Array.from(new Set(errors)).slice(0, 3);
  return `${label}: ${succeeded}/${results.length} succeeded — ${failed} failed (${uniqueErrors.join("; ")}).`;
}

export function BulkActionBar({ targets, plants, disabled, onDone }: BulkActionBarProps) {
  const [activeAction, setActiveAction] = useState<BulkActionKind | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [plantId, setPlantId] = useState(plants[0]?.id ?? "");
  const [targetStage, setTargetStage] = useState<(typeof OVERRIDABLE_STAGES)[number]>("VEGETATIVE");
  const [harvestAmount, setHarvestAmount] = useState("1");
  const [harvestUnit, setHarvestUnit] = useState("oz");
  const [noteBody, setNoteBody] = useState("");

  const busy = disabled || isRunning;

  async function run(kind: BulkActionKind, execute: (target: BulkTarget) => Promise<ActionResult>): Promise<void> {
    setIsRunning(true);
    try {
      const results = await Promise.allSettled(targets.map(execute));
      await onDone(summarize(ACTION_LABEL[kind], results));
      setActiveAction(null);
    } finally {
      setIsRunning(false);
    }
  }

  function handlePlant(): void {
    if (!plantId) return;
    void run("plant", (target) =>
      assignInventoryPlantAction({
        bedId: target.bedId,
        column: target.column,
        row: target.row,
        plantId,
        amount: 1,
        mode: "replace",
      }),
    );
  }

  function handleWater(): void {
    void run("water", (target) => waterCellAction({ bedId: target.bedId, column: target.column, row: target.row }));
  }

  function handleWeed(): void {
    void run("weed", (target) => applyWeedingAction({ bedId: target.bedId, column: target.column, row: target.row }));
  }

  function handleStage(): void {
    void run("stage", async (target) => {
      if (!target.primaryCellPlantingId) {
        return { ok: false, error: "No active planting in this cell." };
      }
      return overridePlantingStageAction({ cellPlantingId: target.primaryCellPlantingId, targetStage });
    });
  }

  function handleHarvest(): void {
    const amount = Number(harvestAmount);
    void run("harvest", async (target) => {
      if (!target.primaryCellPlantingId) {
        return { ok: false, error: "No active planting in this cell." };
      }
      if (!Number.isFinite(amount) || amount <= 0) {
        return { ok: false, error: "Enter a harvest amount greater than 0." };
      }
      return recordHarvestAction({ cellPlantingId: target.primaryCellPlantingId, amount, unit: harvestUnit });
    });
  }

  function handleNote(): void {
    const body = noteBody.trim();
    if (!body) return;
    void run("note", (target) => {
      const formData = new FormData();
      formData.set("body", body);
      formData.set("bedId", target.bedId);
      formData.set("column", String(target.column));
      formData.set("row", String(target.row));
      return createJournalNoteAction(formData);
    });
  }

  function toggleAction(kind: BulkActionKind): void {
    setActiveAction((current) => (current === kind ? null : kind));
  }

  return (
    <div
      className="flex flex-col gap-3 rounded-xl border p-3 sm:p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          {targets.length} cell{targets.length === 1 ? "" : "s"} selected
        </p>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(ACTION_LABEL) as BulkActionKind[]).map((kind) => (
            <button
              key={kind}
              type="button"
              disabled={busy}
              aria-pressed={activeAction === kind}
              onClick={() => toggleAction(kind)}
              className={`${MIN_TOUCH_TARGET} rounded-md border px-2.5 text-xs font-medium disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
              style={{
                borderColor: "var(--color-border)",
                background: activeAction === kind ? "var(--color-surface)" : "transparent",
                color: "var(--color-text)",
              }}
            >
              {ACTION_LABEL[kind]}
            </button>
          ))}
        </div>
      </div>

      {activeAction === "plant" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Plant
            <select
              value={plantId}
              onChange={(event) => setPlantId(event.target.value)}
              className="mt-1 min-h-11 w-48 rounded-md border bg-[var(--color-surface)] px-3"
              style={{ borderColor: "var(--color-border)" }}
            >
              {plants.map((plant) => (
                <option key={plant.id} value={plant.id}>
                  {plantName(plants, plant.id)}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy || !plantId} onClick={handlePlant} className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`} style={{ borderColor: "var(--color-border)" }}>
            Plant in {targets.length} cell{targets.length === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {activeAction === "water" && (
        <div className="flex flex-wrap items-end gap-2">
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            Manually mark every selected cell as watered.
          </p>
          <button type="button" disabled={busy} onClick={handleWater} className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`} style={{ borderColor: "var(--color-border)" }}>
            Water {targets.length} cell{targets.length === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {activeAction === "weed" && (
        <div className="flex flex-wrap items-end gap-2">
          <button type="button" disabled={busy} onClick={handleWeed} className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`} style={{ borderColor: "var(--color-border)" }}>
            Weed {targets.length} cell{targets.length === 1 ? "" : "s"}
          </button>
        </div>
      )}

      {activeAction === "stage" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Set stage
            <select
              value={targetStage}
              onChange={(event) => setTargetStage(event.target.value as (typeof OVERRIDABLE_STAGES)[number])}
              className="mt-1 min-h-11 w-48 rounded-md border bg-[var(--color-surface)] px-3"
              style={{ borderColor: "var(--color-border)" }}
            >
              {OVERRIDABLE_STAGES.map((stage) => (
                <option key={stage} value={stage}>
                  {PHENOLOGY_LABEL[stage] ?? stage}
                </option>
              ))}
            </select>
          </label>
          <button type="button" disabled={busy} onClick={handleStage} className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`} style={{ borderColor: "var(--color-border)" }}>
            Apply to {targets.length} cell{targets.length === 1 ? "" : "s"}
          </button>
          <p className="basis-full text-xs" style={{ color: "var(--color-text-muted)" }}>
            Cells with no active planting are skipped.
          </p>
        </div>
      )}

      {activeAction === "harvest" && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            Amount
            <input
              type="number"
              min="0"
              step="0.1"
              value={harvestAmount}
              onChange={(event) => setHarvestAmount(event.target.value)}
              className="mt-1 min-h-11 w-24 rounded-md border bg-[var(--color-surface)] px-3"
              style={{ borderColor: "var(--color-border)" }}
            />
          </label>
          <label className="text-sm">
            Unit
            <input
              type="text"
              value={harvestUnit}
              onChange={(event) => setHarvestUnit(event.target.value)}
              className="mt-1 min-h-11 w-20 rounded-md border bg-[var(--color-surface)] px-3"
              style={{ borderColor: "var(--color-border)" }}
            />
          </label>
          <button type="button" disabled={busy} onClick={handleHarvest} className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`} style={{ borderColor: "var(--color-border)" }}>
            Harvest {targets.length} cell{targets.length === 1 ? "" : "s"}
          </button>
          <p className="basis-full text-xs" style={{ color: "var(--color-text-muted)" }}>
            Cells with no active planting are skipped.
          </p>
        </div>
      )}

      {activeAction === "note" && (
        <div className="flex flex-col gap-2">
          <label className="text-sm">
            Note
            <textarea
              value={noteBody}
              onChange={(event) => setNoteBody(event.target.value)}
              rows={2}
              className="mt-1 w-full rounded-md border bg-[var(--color-surface)] px-3 py-2"
              style={{ borderColor: "var(--color-border)" }}
            />
          </label>
          <button
            type="button"
            disabled={busy || !noteBody.trim()}
            onClick={handleNote}
            className={`self-start rounded-md border px-3 ${MIN_TOUCH_TARGET}`}
            style={{ borderColor: "var(--color-border)" }}
          >
            Add note to {targets.length} cell{targets.length === 1 ? "" : "s"}
          </button>
        </div>
      )}
    </div>
  );
}

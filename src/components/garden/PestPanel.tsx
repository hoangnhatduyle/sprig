"use client";

// Bed-scoped pest/predator panel — the UI half of two already-built but
// previously unwired server actions (applyPesticideAction,
// releasePredatorsAction in @/app/actions.ts). Pests/predators are
// per-Bed state (like equipment), so this mirrors ConditionsPanel.tsx's
// structure: bed multi-select, an active-population readout, then the
// action controls, sharing the same onChanged refresh-callback contract.

import { useMemo, useState } from "react";
import { applyPesticideAction, releasePredatorsAction } from "@/app/actions";
import { PEST_DEFINITIONS } from "@/domain/pests/pest-catalog";
import { PREDATOR_DEFINITIONS } from "@/domain/pests/predator-catalog";
import {
  MIN_DISPLAY_POPULATION,
  PEST_ICON,
  PEST_LABEL,
  PEST_PRESSURE_LABEL,
  PREDATOR_ICON,
  PREDATOR_LABEL,
  pestPressureBand,
} from "./pest-display";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import type { SnapshotBed } from "./types";

// Mirrors pest-action-service.ts's MAX_PREDATOR_RELEASE_AMOUNT — a
// display/input bound only; the server re-validates independently, so a
// stale client copy can only be overly permissive in the UI, never bypass
// the real limit (same rationale as equipment-display.ts's
// EQUIPMENT_KIND_MAX_INTENSITY).
const MAX_PREDATOR_RELEASE_AMOUNT = 5;

export interface PestPanelProps {
  beds: SnapshotBed[];
  disabled?: boolean;
  onChanged?: () => Promise<void>;
  // When true, skips the card chrome (border/background/shadow) so this can
  // be nested inside GardenTopTabs' "What-if Planner" tab panel alongside
  // ConditionsPanel, which already provides it — same convention as
  // ConditionsPanelProps.bare, instead of stacking card-in-card.
  bare?: boolean;
}

export function PestPanel({ beds, disabled = false, onChanged, bare = false }: PestPanelProps) {
  const [selectedBedIds, setSelectedBedIds] = useState<string[]>([]);
  const [pestKey, setPestKey] = useState(PEST_DEFINITIONS[0]?.key ?? "");
  const [broadSpectrum, setBroadSpectrum] = useState(false);
  const [predatorKey, setPredatorKey] = useState(PREDATOR_DEFINITIONS[0]?.key ?? "");
  const [releaseAmount, setReleaseAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const pestsByBed = useMemo(() => Object.fromEntries(beds.map((bed) => [bed.id, bed.pests])), [beds]);
  const predatorsByBed = useMemo(() => Object.fromEntries(beds.map((bed) => [bed.id, bed.predators])), [beds]);

  function toggleBed(bedId: string): void {
    setSelectedBedIds((prev) => (prev.includes(bedId) ? prev.filter((id) => id !== bedId) : [...prev, bedId]));
  }

  async function handleApplyPesticide(): Promise<void> {
    if (selectedBedIds.length === 0 || busy || !pestKey) return;
    setBusy(true);
    setMessage(null);
    try {
      for (const bedId of selectedBedIds) {
        const result = await applyPesticideAction({ bedId, pestKey, broadSpectrum });
        if (!result.ok) {
          setMessage(result.error ?? "Couldn't apply pesticide.");
          return;
        }
      }
      await onChanged?.();
      setMessage(`${PEST_LABEL[pestKey] ?? pestKey} treated on ${selectedBedIds.length} bed${selectedBedIds.length === 1 ? "" : "s"}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleReleasePredators(): Promise<void> {
    if (selectedBedIds.length === 0 || busy || !predatorKey) return;
    const amount = Number(releaseAmount);
    if (!Number.isFinite(amount) || amount < 0 || amount > MAX_PREDATOR_RELEASE_AMOUNT) {
      setMessage(`Enter an amount between 0 and ${MAX_PREDATOR_RELEASE_AMOUNT}.`);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      for (const bedId of selectedBedIds) {
        const result = await releasePredatorsAction({ bedId, predatorKey, amount });
        if (!result.ok) {
          setMessage(result.error ?? "Couldn't release predators.");
          return;
        }
      }
      await onChanged?.();
      setMessage(`${PREDATOR_LABEL[predatorKey] ?? predatorKey} released on ${selectedBedIds.length} bed${selectedBedIds.length === 1 ? "" : "s"}.`);
    } finally {
      setBusy(false);
    }
  }

  const Wrapper = bare ? "div" : "section";

  return (
    <Wrapper
      className={bare ? undefined : "rounded-xl border p-4 sm:p-5"}
      style={
        bare
          ? undefined
          : {
              borderColor: "var(--color-border)",
              background: "var(--color-surface-raised)",
              boxShadow: "var(--shadow-card)",
            }
      }
      aria-labelledby="pest-panel-heading"
    >
      {!bare && (
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--color-clay-strong)" }}>
          What-if Planner
        </p>
      )}
      <h2 id="pest-panel-heading" className="mb-3 text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
        Pests &amp; predators
      </h2>

      <fieldset className="mb-4">
        <legend className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>
          Beds
        </legend>
        <div className="flex flex-wrap gap-2">
          {beds.map((bed) => (
            <label
              key={bed.id}
              className={`flex items-center gap-2 rounded-md border px-3 ${MIN_TOUCH_TARGET} text-sm ${FOCUS_RING}`}
              style={{
                borderColor: selectedBedIds.includes(bed.id) ? "var(--color-accent)" : "var(--color-border)",
                background: selectedBedIds.includes(bed.id) ? "var(--color-surface)" : "transparent",
              }}
            >
              <input type="checkbox" checked={selectedBedIds.includes(bed.id)} onChange={() => toggleBed(bed.id)} disabled={disabled} />
              {bed.name}
            </label>
          ))}
        </div>
      </fieldset>

      {selectedBedIds.length > 0 && (
        <div className="mb-5">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>
            Active pests
          </p>
          <ul className="flex flex-col gap-1.5">
            {selectedBedIds.flatMap((bedId) => {
              const bed = beds.find((candidate) => candidate.id === bedId);
              return (pestsByBed[bedId] ?? [])
                .filter((pest) => pest.population >= MIN_DISPLAY_POPULATION)
                .map((pest) => {
                  const Icon = PEST_ICON[pest.pestKey];
                  const band = pestPressureBand(pest.population);
                  return (
                    <li
                      key={`${bedId}-${pest.pestKey}`}
                      className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                      style={{ borderColor: "var(--color-border)" }}
                    >
                      {Icon && <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />}
                      {PEST_LABEL[pest.pestKey] ?? pest.pestKey} on {bed?.name} — {PEST_PRESSURE_LABEL[band]} pressure
                    </li>
                  );
                });
            })}
            {selectedBedIds.every((bedId) => (pestsByBed[bedId] ?? []).every((pest) => pest.population < MIN_DISPLAY_POPULATION)) && (
              <li className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                No notable pest pressure.
              </li>
            )}
          </ul>
          {selectedBedIds.some((bedId) => (predatorsByBed[bedId] ?? []).some((predator) => predator.population >= MIN_DISPLAY_POPULATION)) && (
            <>
              <p className="mb-1.5 mt-3 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>
                Active predators
              </p>
              <ul className="flex flex-col gap-1.5">
                {selectedBedIds.flatMap((bedId) => {
                  const bed = beds.find((candidate) => candidate.id === bedId);
                  return (predatorsByBed[bedId] ?? [])
                    .filter((predator) => predator.population >= MIN_DISPLAY_POPULATION)
                    .map((predator) => {
                      const Icon = PREDATOR_ICON[predator.predatorKey];
                      return (
                        <li
                          key={`${bedId}-${predator.predatorKey}`}
                          className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm"
                          style={{ borderColor: "var(--color-border)" }}
                        >
                          {Icon && <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />}
                          {PREDATOR_LABEL[predator.predatorKey] ?? predator.predatorKey} on {bed?.name} ({predator.population.toFixed(1)})
                        </li>
                      );
                    });
                })}
              </ul>
            </>
          )}
        </div>
      )}

      <div className="mb-6 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
        <h3 className="font-semibold">Apply pesticide</h3>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Knocks the targeted pest down hard, but not to zero. Broad-spectrum also suppresses predators on the selected beds.
        </p>
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <label className="block text-sm">
            Pest
            {/* Explicit `block` — without it this <select> sits inline right
                after the label text once `sm:w-48` drops the `w-full` that
                would otherwise force a line break (same fix as
                ConditionsPanel.tsx's Equipment select). */}
            <select
              value={pestKey}
              onChange={(event) => setPestKey(event.target.value)}
              className={`mt-1 block ${MIN_TOUCH_TARGET} w-full rounded-md border bg-[var(--color-surface)] px-3 sm:w-48`}
              style={{ borderColor: "var(--color-border)" }}
            >
              {PEST_DEFINITIONS.map((pest) => (
                <option key={pest.key} value={pest.key}>
                  {PEST_LABEL[pest.key] ?? pest.key}
                </option>
              ))}
            </select>
          </label>
          <label className={`flex items-center gap-2 text-sm ${MIN_TOUCH_TARGET}`}>
            <input type="checkbox" checked={broadSpectrum} onChange={(event) => setBroadSpectrum(event.target.checked)} />
            Broad-spectrum
          </label>
          <button
            type="button"
            disabled={disabled || busy || selectedBedIds.length === 0}
            onClick={() => void handleApplyPesticide()}
            className={`rounded-md bg-[var(--color-cta-bg)] px-4 font-semibold text-[var(--color-cta-text)] ${MIN_TOUCH_TARGET} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            Apply
          </button>
        </div>
      </div>

      <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
        <h3 className="font-semibold">Release predators</h3>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          A direct, bounded population addition (0–{MAX_PREDATOR_RELEASE_AMOUNT}) on the selected beds.
        </p>
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <label className="block text-sm">
            Predator
            {/* Explicit `block` — same fix as the Pest select above. */}
            <select
              value={predatorKey}
              onChange={(event) => setPredatorKey(event.target.value)}
              className={`mt-1 block ${MIN_TOUCH_TARGET} w-full rounded-md border bg-[var(--color-surface)] px-3 sm:w-48`}
              style={{ borderColor: "var(--color-border)" }}
            >
              {PREDATOR_DEFINITIONS.map((predator) => (
                <option key={predator.key} value={predator.key}>
                  {PREDATOR_LABEL[predator.key] ?? predator.key}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Amount
            {/* Explicit `block` — a fixed-width input (w-24, no responsive
                w-full to "accidentally" force the wrap) has the same inline-
                after-label-text problem as the selects above. */}
            <input
              type="number"
              min={0}
              max={MAX_PREDATOR_RELEASE_AMOUNT}
              step={0.5}
              value={releaseAmount}
              onChange={(event) => setReleaseAmount(event.target.value)}
              className={`mt-1 block ${MIN_TOUCH_TARGET} w-24 rounded-md border bg-[var(--color-surface)] px-3`}
              style={{ borderColor: "var(--color-border)" }}
            />
          </label>
          <button
            type="button"
            disabled={disabled || busy || selectedBedIds.length === 0}
            onClick={() => void handleReleasePredators()}
            className={`rounded-md border px-4 font-semibold ${MIN_TOUCH_TARGET} disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
            style={{ borderColor: "var(--color-border)" }}
          >
            Release
          </button>
        </div>
      </div>

      {message && (
        <p role="status" className="mt-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {message}
        </p>
      )}
    </Wrapper>
  );
}

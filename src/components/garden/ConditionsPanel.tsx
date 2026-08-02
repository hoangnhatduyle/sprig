"use client";

// The manual conditions override panel (architecture doc §19): real,
// persistent "equipment" that actually changes a bed's future growth
// (installConditionOverrideAction/removeConditionOverrideAction), and a
// non-committal what-if preview that never does
// (previewConditionsAction) — both share the same bed-selection UI and the
// same light/rain vocabulary, so trying a preset and then installing it for
// real is one continuous flow, not two disconnected features.

import { useMemo, useState } from "react";
import type { ConditionOverrideKind } from "@prisma/client";
import {
  installConditionOverrideAction,
  previewConditionsAction,
  removeConditionOverrideAction,
} from "@/app/actions";
import type { PlantingProjection } from "@/domain/conditions/whatif-projection-service";
import {
  EQUIPMENT_KIND_EFFECT as KIND_EFFECT,
  EQUIPMENT_KIND_ICON as KIND_ICON,
  EQUIPMENT_KIND_LABEL as KIND_LABEL,
  EQUIPMENT_KIND_MAX_INTENSITY as KIND_MAX_INTENSITY,
} from "./equipment-display";
import { PHENOLOGY_LABEL } from "./status-display";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import type { SnapshotBed } from "./types";

export interface ConditionsPanelProps {
  beds: SnapshotBed[];
  disabled?: boolean;
  // Called after a successful install/remove so the parent re-fetches the
  // snapshot (equipment now lives on it, see grid-cell-service.ts's
  // SnapshotBed.equipment) — mirrors InventoryPanel's existing onChanged
  // contract. Replaces this panel's previous independent
  // listConditionOverridesAction polling loop, which could drift from what
  // the grid/3D viewer showed for the same bed.
  onChanged?: () => Promise<void>;
  // When true, skips the card chrome (border/background/shadow) so this can
  // be nested inside GardenTopTabs' "What-if Planner" tab panel, which
  // already provides it, instead of stacking card-in-card.
  bare?: boolean;
}

// What each preset button actually fills into the sandbox fields below it —
// the buttons themselves only have room for an icon and a short label, so
// this is surfaced via a hover/focus tooltip (see the preset button markup).
const PRESET_PREVIEW_HINT: Record<ConditionOverrideKind, string> = {
  SHADE_CLOTH: "Sets light to 60% below so you can preview shade cloth's effect before installing it for real.",
  GROW_LIGHT: "Sets light to 140% below so you can preview a grow light's effect before installing it for real.",
  RAIN_COVER: "Sets rain to 20% below so you can preview a rain cover's effect before installing it for real.",
};

function canopyPercent(biology: PlantingProjection["startingBiology"]): number {
  return Math.round((biology.leafFraction + biology.stemFraction) * 50);
}

function ProjectionSummary({ projection, bedName }: { projection: PlantingProjection; bedName: string }) {
  const last = projection.days[projection.days.length - 1];
  const start = projection.startingBiology;
  const end = last.biology;
  return (
    <li className="rounded-md border px-3 py-2 text-sm" style={{ borderColor: "var(--color-border)" }}>
      <p className="font-medium" style={{ color: "var(--color-text)" }}>
        {bedName}, column {projection.column}, row {projection.row}
      </p>
      <p style={{ color: "var(--color-text-muted)" }}>
        {PHENOLOGY_LABEL[start.phenologyStage] ?? start.phenologyStage} → {PHENOLOGY_LABEL[end.phenologyStage] ?? end.phenologyStage}
        {" · canopy "}
        {canopyPercent(start)}% → {canopyPercent(end)}%
        {end.fruitFraction > 0.02 && ` · fruit ${Math.round(end.fruitFraction * 100)}%`}
        {end.waterContentIndex < 0.5 && " · wilting"}
        {end.cumulativeStress > 0.6 && " · under sustained stress"}
      </p>
    </li>
  );
}

export function ConditionsPanel({ beds, disabled = false, onChanged, bare = false }: ConditionsPanelProps) {
  const [selectedBedIds, setSelectedBedIds] = useState<string[]>([]);
  const [kind, setKind] = useState<ConditionOverrideKind>("SHADE_CLOTH");
  const [intensity, setIntensity] = useState(0.4);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const [projectionDays, setProjectionDays] = useState("14");
  const [previewLight, setPreviewLight] = useState("1");
  const [previewRain, setPreviewRain] = useState("1");
  const [previewing, setPreviewing] = useState(false);
  const [projections, setProjections] = useState<PlantingProjection[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  // Derived from the snapshot's own bed.equipment (grid-cell-service.ts),
  // not a separate fetch — see ConditionsPanelProps.onChanged above.
  const overridesByBed = useMemo(
    () => Object.fromEntries(beds.map((bed) => [bed.id, bed.equipment])),
    [beds],
  );

  function toggleBed(bedId: string): void {
    setSelectedBedIds((prev) => (prev.includes(bedId) ? prev.filter((id) => id !== bedId) : [...prev, bedId]));
    setProjections(null);
  }

  function handleKindChange(nextKind: ConditionOverrideKind): void {
    setKind(nextKind);
    setIntensity((prev) => Math.min(prev, KIND_MAX_INTENSITY[nextKind]));
  }

  async function handleInstall(): Promise<void> {
    if (selectedBedIds.length === 0 || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      for (const bedId of selectedBedIds) {
        const result = await installConditionOverrideAction({ bedId, kind, intensity });
        if (!result.ok) {
          setMessage(result.error ?? "Couldn't install that equipment.");
          return;
        }
      }
      await onChanged?.();
      setMessage(
        `${KIND_LABEL[kind]} installed on ${selectedBedIds.length} bed${selectedBedIds.length === 1 ? "" : "s"}.`,
      );
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(overrideId: string): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await removeConditionOverrideAction(overrideId);
      if (!result.ok) {
        setMessage(result.error ?? "Couldn't remove that equipment.");
        return;
      }
      await onChanged?.();
    } finally {
      setBusy(false);
    }
  }

  async function handlePreview(): Promise<void> {
    if (selectedBedIds.length === 0 || previewing) return;
    setPreviewing(true);
    setPreviewError(null);
    setProjections(null);
    try {
      const result = await previewConditionsAction({
        bedIds: selectedBedIds,
        projectionDays: Number(projectionDays),
        overrides: [
          { bedIds: selectedBedIds, lightMultiplier: Number(previewLight), rainMultiplier: Number(previewRain) },
        ],
      });
      if (!result.ok) {
        setPreviewError(result.error ?? "Couldn't run that preview.");
        return;
      }
      setProjections(result.projections ?? []);
    } finally {
      setPreviewing(false);
    }
  }

  function applyPreset(presetKind: ConditionOverrideKind): void {
    setPreviewLight(presetKind === "SHADE_CLOTH" ? "0.6" : presetKind === "GROW_LIGHT" ? "1.4" : "1");
    setPreviewRain(presetKind === "RAIN_COVER" ? "0.2" : "1");
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
      aria-labelledby="conditions-heading"
    >
      {!bare && (
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--color-clay-strong)" }}>
          What-if Planner
        </p>
      )}
      <h2 id="conditions-heading" className="mb-3 text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
        Conditions
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
            Active equipment
          </p>
          <ul className="flex flex-col gap-1.5">
            {selectedBedIds.flatMap((bedId) => {
              const bed = beds.find((candidate) => candidate.id === bedId);
              return (overridesByBed[bedId] ?? []).map((override) => (
                <li
                  key={override.id}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-sm"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <span className="inline-flex items-center gap-1.5">
                    {(() => {
                      const Icon = KIND_ICON[override.kind];
                      return <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />;
                    })()}
                    {KIND_LABEL[override.kind]} on {bed?.name} ({Math.round(override.intensity * 100)}%, {KIND_EFFECT[override.kind]})
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void handleRemove(override.id)}
                    className={`rounded text-xs font-medium underline decoration-dotted underline-offset-4 ${FOCUS_RING}`}
                    style={{ color: "var(--color-text-muted)" }}
                  >
                    Remove
                  </button>
                </li>
              ));
            })}
            {selectedBedIds.every((bedId) => (overridesByBed[bedId] ?? []).length === 0) && (
              <li className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                No equipment installed.
              </li>
            )}
          </ul>
        </div>
      )}

      <div className="mb-6 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
        <h3 className="font-semibold">Install real equipment</h3>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Actually changes the selected bed{"'"}s future growth, starting next time it{"'"}s checked.
        </p>
        <div className="grid gap-3 sm:grid-cols-[auto_1fr_auto] sm:items-end">
          <label className="text-sm">
            Equipment
            {/* Explicit `block` — without it this <select> sits inline right
                after the label text once `sm:w-48` drops the `w-full` that
                was otherwise accidentally forcing a line break. */}
            <select
              value={kind}
              onChange={(event) => handleKindChange(event.target.value as ConditionOverrideKind)}
              className={`mt-1 block ${MIN_TOUCH_TARGET} w-full rounded-md border bg-[var(--color-surface)] px-3 sm:w-48`}
              style={{ borderColor: "var(--color-border)" }}
            >
              {(Object.keys(KIND_LABEL) as ConditionOverrideKind[]).map((option) => (
                <option key={option} value={option}>
                  {KIND_LABEL[option]}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Intensity ({Math.round(intensity * 100)}%, {KIND_EFFECT[kind]})
            <input
              type="range"
              min={0}
              max={KIND_MAX_INTENSITY[kind]}
              step={0.05}
              value={intensity}
              onChange={(event) => setIntensity(Number(event.target.value))}
              className="mt-2 block w-full"
            />
          </label>
          <button
            type="button"
            disabled={disabled || busy || selectedBedIds.length === 0}
            onClick={() => void handleInstall()}
            className={`rounded-md bg-[var(--color-cta-bg)] px-4 font-semibold text-[var(--color-cta-text)] ${MIN_TOUCH_TARGET} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            Install
          </button>
        </div>
        {message && (
          <p role="status" className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            {message}
          </p>
        )}
      </div>

      <div className="rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
        <h3 className="font-semibold">Preview a what-if scenario</h3>
        <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Projects the selected bed{"'"}s plants forward under different conditions — never saved, never affects the real garden.
        </p>
        <div className="mb-2 flex flex-wrap gap-2">
          {(Object.keys(KIND_LABEL) as ConditionOverrideKind[]).map((preset) => {
            const Icon = KIND_ICON[preset];
            const hintId = `preset-hint-${preset}`;
            return (
              // `group` + `relative` scope the tooltip below to this one
              // button — group-hover for mouse, group-focus-within so
              // keyboard tab and mobile tap (which focuses the button before
              // its click fires) both reveal it too.
              <div key={preset} className="group relative">
                <button
                  type="button"
                  onClick={() => applyPreset(preset)}
                  title={PRESET_PREVIEW_HINT[preset]}
                  aria-describedby={hintId}
                  className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs ${FOCUS_RING}`}
                  style={{ borderColor: "var(--color-border)" }}
                >
                  <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                  {KIND_LABEL[preset]} preset
                </button>
                <span
                  id={hintId}
                  role="tooltip"
                  className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-max max-w-56 -translate-x-1/2 rounded-md border px-2 py-1.5 text-xs opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
                  style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)", color: "var(--color-text)" }}
                >
                  {PRESET_PREVIEW_HINT[preset]}
                </span>
              </div>
            );
          })}
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Days to project
            <input
              type="number"
              min={1}
              max={60}
              value={projectionDays}
              onChange={(event) => setProjectionDays(event.target.value)}
              className={`mt-1 ${MIN_TOUCH_TARGET} w-full rounded-md border bg-[var(--color-surface)] px-3`}
              style={{ borderColor: "var(--color-border)" }}
            />
          </label>
          <label className="text-sm">
            Light (1 = normal, sandbox range)
            <input
              type="number"
              step="0.1"
              min={0}
              max={3}
              value={previewLight}
              onChange={(event) => setPreviewLight(event.target.value)}
              className={`mt-1 ${MIN_TOUCH_TARGET} w-full rounded-md border bg-[var(--color-surface)] px-3`}
              style={{ borderColor: "var(--color-border)" }}
            />
          </label>
          <label className="text-sm">
            Rain (1 = normal, sandbox range)
            <input
              type="number"
              step="0.1"
              min={0}
              max={3}
              value={previewRain}
              onChange={(event) => setPreviewRain(event.target.value)}
              className={`mt-1 ${MIN_TOUCH_TARGET} w-full rounded-md border bg-[var(--color-surface)] px-3`}
              style={{ borderColor: "var(--color-border)" }}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={disabled || previewing || selectedBedIds.length === 0}
          onClick={() => void handlePreview()}
          className={`mt-3 rounded-md border px-4 font-semibold ${MIN_TOUCH_TARGET} disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
          style={{ borderColor: "var(--color-border)" }}
        >
          {previewing ? "Running preview…" : "Run preview"}
        </button>
        {previewError && (
          <p role="alert" className="mt-2 text-sm" style={{ color: "var(--color-danger-text)" }}>
            {previewError}
          </p>
        )}
        {projections && (
          <ul className="mt-3 flex flex-col gap-1.5" aria-live="polite">
            {projections.length === 0 && (
              <li className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                Nothing planted in the selected bed{selectedBedIds.length === 1 ? "" : "s"} to project.
              </li>
            )}
            {projections.map((projection) => (
              <ProjectionSummary
                key={projection.cellPlantingId}
                projection={projection}
                bedName={beds.find((bed) => bed.id === projection.bedId)?.name ?? "Bed"}
              />
            ))}
          </ul>
        )}
      </div>
    </Wrapper>
  );
}

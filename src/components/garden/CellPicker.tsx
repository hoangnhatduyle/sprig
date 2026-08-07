"use client";

import { useState } from "react";
import type { ActionResult, CellTarget } from "@/app/actions";
import { plantName } from "./plant-lookup";
import { PHENOLOGY_LABEL, STATUS_STYLES, STATUS_WORD } from "./status-display";
import {
  HEALTH_BAND_CSS,
  HEALTH_BAND_ICON,
  HEALTH_BAND_LABEL,
  STRESS_DIAL_LABEL,
  healthBand,
  type GrowthView,
} from "./stress-display";
import { estimatedHeightCm, stageProgress } from "./growth-progress";
import { DISEASE_LABEL, diseaseSeverityBand } from "./pest-display";
import { COMPANION_EFFECT_ICON, COMPANION_EFFECT_LABEL } from "./companion-effect-display";
import {
  NUTRIENT_LABEL,
  lowNutrients,
  textureLabel,
  weedPressureBand,
  WEED_PRESSURE_LABEL,
  MIN_DISPLAY_WEED_PRESSURE,
} from "./soil-display";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import type { PlantOption, SelectedCell, SnapshotSoilProfile } from "./types";

type CellPickerProps = {
  cell: SelectedCell;
  plants: PlantOption[];
  isOpen: boolean;
  isSubmitting: boolean;
  onOpen: () => void;
  onAssign: (plantId: string) => void;
  onAddCompanion: (plantId: string) => void;
  onRemovePlant?: (plantId: string) => void;
  onCancel: () => void;
  onDeselect: () => void;
  error: string | null;
  onRefresh?: () => Promise<void>;
  recordHarvest?: (input: {
    cellPlantingId: string;
    amount: number;
    unit: string;
    notes?: string;
  }) => Promise<ActionResult>;
  advancePlanting?: (target: Omit<CellTarget, "plantId">, event: "finish") => Promise<ActionResult>;
  overridePlantingStage?: (input: { cellPlantingId: string; targetStage: string }) => Promise<ActionResult>;
  applyMulch?: (input: { bedId: string; column: number; row: number; depthMm: number }) => Promise<ActionResult>;
  applyCompost?: (input: { bedId: string; column: number; row: number; amount: number }) => Promise<ActionResult>;
  applyFertilizer?: (input: {
    bedId: string;
    column: number;
    row: number;
    kind: "SYNTHETIC" | "ORGANIC";
    n: number;
    p: number;
    k: number;
  }) => Promise<ActionResult>;
  applyFungicide?: (input: { bedId: string; column: number; row: number }) => Promise<ActionResult>;
  applyWeeding?: (input: { bedId: string; column: number; row: number }) => Promise<ActionResult>;
  createJournalNote?: (formData: FormData) => Promise<ActionResult>;
};

// A compact badge for the dominant stress dial — falls back to the raw dial
// key (rather than rendering nothing) when STRESS_DIAL_LABEL is ever missing
// an entry for a future dial, the exact failure mode that previously made
// "pestDisease" silently disappear.
function StressBadge({ dial, band }: { dial: string; band: "watch" | "stressed" | "critical" }) {
  const label = STRESS_DIAL_LABEL[dial] ?? dial;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium" style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}>
      <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${HEALTH_BAND_CSS[band]}`} />
      {label}
    </span>
  );
}

// A compact, at-a-glance read of the growth engine's own state
// (src/domain/growth) — the plant now advances on its own, so this panel's
// job shifts from "click to advance" to "see what's happening and why".
function GrowthReadout({ growth }: { growth: GrowthView | null }) {
  if (!growth) {
    return null;
  }
  const canopy = Math.round((growth.leafFraction + growth.stemFraction) * 50);
  const fruit = Math.round(growth.fruitFraction * 100);
  const band = healthBand(growth);
  const progress = stageProgress(growth);
  const heightCm = Math.round(estimatedHeightCm(growth));
  return (
    <div className="mt-2">
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        {PHENOLOGY_LABEL[growth.phenologyStage] ?? growth.phenologyStage} · canopy {canopy}%
        {growth.fruitFraction > 0 && ` · fruit ${fruit}%`}
        {growth.waterContentIndex < 0.5 && " · wilting from drought"}
      </p>
      {band !== "healthy" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span
            className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
            style={{ background: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}
          >
            <span aria-hidden="true" className={`inline-block h-2 w-2 shrink-0 rounded-full ${HEALTH_BAND_CSS[band]}`} />
            {(() => {
              const HealthIcon = HEALTH_BAND_ICON[band];
              return <HealthIcon aria-hidden="true" className="h-3.5 w-3.5" />;
            })()}
            {HEALTH_BAND_LABEL[band]}
          </span>
          {growth.dominantStressDial && <StressBadge dial={growth.dominantStressDial} band={band} />}
        </div>
      )}
      <label className="mt-2 block text-xs" style={{ color: "var(--color-text-muted)" }}>
        Sustained stress
        <meter
          className="ml-2 align-middle"
          min={0}
          max={1}
          low={0.3}
          high={0.6}
          optimum={0}
          value={growth.cumulativeStress}
          aria-label={`Sustained stress: ${Math.round(growth.cumulativeStress * 100)}%`}
        />
      </label>
      {progress ? (
        <label className="mt-2 block text-xs" style={{ color: "var(--color-text-muted)" }}>
          Progress to {PHENOLOGY_LABEL[progress.nextStage] ?? progress.nextStage}
          {/* <progress>, not <meter>: this is completion toward a goal, not a
              gauge/level reading (the latter is what Sustained stress above
              and InfectionReadout's severity meter correctly use <meter> for). */}
          <progress
            className="ml-2 align-middle"
            max={1}
            value={progress.fraction}
            aria-label={`Progress to ${PHENOLOGY_LABEL[progress.nextStage] ?? progress.nextStage}: ${Math.round(progress.fraction * 100)}%`}
          />
        </label>
      ) : (
        <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
          Fully grown
        </p>
      )}
      <p className="mt-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
        ~{heightCm}cm of an expected {Math.round(growth.matureHeightCm)}cm (estimate)
      </p>
    </div>
  );
}

// Nutrient/mulch/texture soil state — CellEnvironmentView is per-cell (a
// companion-planted cell shares one soil, so this reads cell.environment
// rather than any one planting's growth view); SnapshotSoilProfile is
// per-bed texture (soilProfile), passed down separately since a raised bed
// is normally a uniform fill (see SoilProfile's own schema comment).
// Replaces the old EnvironmentReadout's single "low on n/p/k" sentence
// (which silently omitted calcium) with exact numbers per nutrient.
function SoilCard({
  environment,
  soilProfile,
}: {
  environment: SelectedCell["environment"];
  soilProfile: SnapshotSoilProfile | null | undefined;
}) {
  if (!environment) {
    return null;
  }
  const low = new Set(lowNutrients(environment));
  const weedBand = weedPressureBand(environment.weedPressureFraction);
  return (
    <div className="mt-1 flex flex-col gap-1.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
      <p>
        Soil moisture {Math.round(environment.soilMoistureFraction * 100)}% · {Math.round(environment.soilTempC)}°C
        {environment.mulchDepthMm > 0 && ` · mulched ${Math.round(environment.mulchDepthMm)}mm`}
      </p>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {(Object.keys(NUTRIENT_LABEL) as Array<keyof typeof NUTRIENT_LABEL>).map((field) => (
          <li key={field} className={low.has(field) ? "font-semibold" : undefined} style={low.has(field) ? { color: "var(--color-warning-text)" } : undefined}>
            {NUTRIENT_LABEL[field]}: {Math.round(environment[field] * 100)}%
          </li>
        ))}
        <li>Micronutrients: {Math.round(environment.micronutrientIndexFraction * 100)}%</li>
      </ul>
      <p className="text-xs">
        Evapotranspiration {environment.evapotranspirationMm.toFixed(1)}mm/day
        {environment.daysNearSaturation > 0 && ` · waterlogged ${Math.round(environment.daysNearSaturation)}d`}
        {environment.residueOrganicMatterPool > 0 && ` · residue ${environment.residueOrganicMatterPool.toFixed(2)}`}
        {environment.weedPressureFraction >= MIN_DISPLAY_WEED_PRESSURE &&
          ` · ${WEED_PRESSURE_LABEL[weedBand].toLowerCase()} weed pressure`}
      </p>
      {soilProfile && (
        <p className="text-xs">
          {textureLabel(soilProfile)} ({Math.round(soilProfile.sandPct)}/{Math.round(soilProfile.siltPct)}/
          {Math.round(soilProfile.clayPct)} sand/silt/clay) · field capacity {Math.round(soilProfile.fieldCapacityFraction * 100)}%, wilting
          point {Math.round(soilProfile.wiltingPointFraction * 100)}%
        </p>
      )}
    </div>
  );
}

// Disease is per-planting (CellPlanting), not per-cell — a companion-planted
// cell can carry two independent infections, so this reads every planting's
// infections rather than assuming plantings[0] is the only source.
function InfectionReadout({ plantings }: { plantings: SelectedCell["plantings"] }) {
  const active = (plantings ?? []).flatMap((planting) =>
    planting.infections.filter((infection) => infection.severity >= 0.05),
  );
  if (active.length === 0) {
    return null;
  }
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {active.map((infection) => {
        const band = diseaseSeverityBand(infection.severity);
        return (
          <label key={infection.diseaseKey} className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
            {DISEASE_LABEL[infection.diseaseKey] ?? infection.diseaseKey}
            <meter
              className="ml-2 align-middle"
              min={0}
              max={1}
              low={0.4}
              high={0.7}
              optimum={0}
              value={infection.severity}
              aria-label={`${DISEASE_LABEL[infection.diseaseKey] ?? infection.diseaseKey} severity: ${Math.round(infection.severity * 100)}% (${band})`}
            />
          </label>
        );
      })}
    </div>
  );
}

// A small inline "Remove" control used next to a plant's name wherever an
// active planting is listed (primary or companion) — a single shared button
// so remove affordances look and behave identically no matter which slot
// the plant occupies.
function RemoveButton({
  plantName: name,
  isSubmitting,
  onRemove,
}: {
  plantName: string;
  isSubmitting: boolean;
  onRemove: () => void;
}) {
  return (
    <button
      type="button"
      disabled={isSubmitting}
      onClick={onRemove}
      aria-label={`Remove ${name} from this cell`}
      className={`rounded text-xs font-medium underline decoration-dotted underline-offset-2 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
      style={{ color: "var(--color-danger-text)" }}
    >
      Remove
    </button>
  );
}

// Mirrors stage-override-service.ts's OVERRIDABLE_STAGES (SENESCENT/DEAD
// aren't reachable via replay, see that file's own comment) — kept local
// here rather than imported since this is UI option-list concern, the same
// "local mirror over cross-domain import" precedent stage-override-service.ts
// itself already establishes for growth-engine-service.ts's stage order.
const OVERRIDABLE_STAGES = ["GERMINATING", "VEGETATIVE", "FLOWERING", "FRUITING", "MATURE"] as const;

// Seeds the "Set stage" dropdown from what the targeted planting is actually
// at right now, instead of a hardcoded "Vegetative" — a fixed default meant
// the dropdown looked plausible regardless of the plant's real stage, making
// it easy to click "Set stage" while believing you'd chosen something you
// hadn't. Falls back to the first reachable stage only when the planting
// has no growth yet or sits in a terminal stage this control can't target.
function currentOverridableStage(cell: SelectedCell, plantingId: string): (typeof OVERRIDABLE_STAGES)[number] {
  const stage = cell.plantings?.find((planting) => planting.id === plantingId)?.growth?.phenologyStage;
  return stage && (OVERRIDABLE_STAGES as readonly string[]).includes(stage)
    ? (stage as (typeof OVERRIDABLE_STAGES)[number])
    : OVERRIDABLE_STAGES[0];
}

const LIFECYCLE_STUB_REASON_ID = "plant-picker-lifecycle-stub-reason";

function HarvestedActions({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="flex max-w-sm flex-col gap-3">
      <p
        id={LIFECYCLE_STUB_REASON_ID}
        className="rounded-md px-3 py-2 text-sm"
        style={{ background: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}
      >
        This cell has been harvested. Clear or remove it before planting again — those lifecycle actions are covered by
        a separate spec.
      </p>
      <div className="flex gap-2">
        {(["Clear cell", "Remove cell"] as const).map((label) => (
          // AC-4 / NC-SPRIG-PLANTUI-NO-DIRECT-HARVESTED-REPLACE: a HARVESTED
          // cell must never offer a direct "replace plant" action — these
          // stubs make that invariant visible without implementing
          // lifecycle-advance behavior (out of scope). aria-disabled (not
          // the native `disabled` attribute) keeps them keyboard/AT
          // reachable so the reason text is discoverable, per
          // aria-describedby below, rather than silently vanishing from the
          // tab order.
          <button
            key={label}
            type="button"
            aria-disabled="true"
            aria-describedby={LIFECYCLE_STUB_REASON_ID}
            onClick={(event) => event.preventDefault()}
            className={`cursor-not-allowed rounded-md border px-3 ${MIN_TOUCH_TARGET} ${FOCUS_RING}`}
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
          >
            {label}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={onCancel}
        className={`self-start rounded text-sm font-medium underline decoration-dotted underline-offset-4 ${FOCUS_RING}`}
        style={{ color: "var(--color-text-muted)" }}
      >
        Close
      </button>
    </div>
  );
}

type PlantOptionsListProps = {
  cell: SelectedCell;
  plants: PlantOption[];
  isSubmitting: boolean;
  hasActivePlant: boolean;
  canAddCompanion: boolean;
  onAssign: (plantId: string) => void;
  onAddCompanion: (plantId: string) => void;
  onCancel: () => void;
};

function PlantOptionsList({
  cell,
  plants,
  isSubmitting,
  hasActivePlant,
  canAddCompanion,
  onAssign,
  onAddCompanion,
  onCancel,
}: PlantOptionsListProps) {
  return (
    <div className="flex max-w-sm flex-col gap-4">
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>
          {hasActivePlant ? "Replace with" : "Assign"}
        </p>
        <ul className="flex flex-col gap-1">
          {plants.map((plant) => (
            <li key={plant.id}>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => onAssign(plant.id)}
                className={`w-full rounded-md border border-[var(--color-border)] px-3 ${MIN_TOUCH_TARGET} text-left text-sm transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
              >
                {plant.commonName}
              </button>
            </li>
          ))}
        </ul>
      </div>

      {canAddCompanion && (
        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>
            Add companion
          </p>
          <ul className="flex flex-col gap-1">
            {plants
              .filter((plant) => !cell.plantIds.includes(plant.id))
              .map((plant) => (
                <li key={plant.id}>
                  <button
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => onAddCompanion(plant.id)}
                    className={`w-full rounded-md border border-[var(--color-border)] px-3 ${MIN_TOUCH_TARGET} text-left text-sm transition-colors hover:border-[var(--color-accent)] hover:bg-[var(--color-surface)] disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
                  >
                    + {plant.commonName}
                  </button>
                </li>
              ))}
          </ul>
        </div>
      )}

      <button
        type="button"
        onClick={onCancel}
        disabled={isSubmitting}
        className={`self-start rounded text-sm font-medium underline decoration-dotted underline-offset-4 disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
        style={{ color: "var(--color-text-muted)" }}
      >
        Cancel
      </button>
    </div>
  );
}

export function CellPicker({
  cell,
  plants,
  isOpen,
  isSubmitting,
  onOpen,
  onAssign,
  onAddCompanion,
  onRemovePlant,
  onCancel,
  onDeselect,
  error,
  onRefresh,
  recordHarvest,
  advancePlanting,
  overridePlantingStage,
  applyMulch,
  applyCompost,
  applyFertilizer,
  applyFungicide,
  applyWeeding,
  createJournalNote,
}: CellPickerProps) {
  const hasActivePlant = cell.plantIds.length > 0;
  const isHarvested = cell.status === "HARVESTED";
  // NC-SPRIG-PLANTUI-NO-COMPANION-ON-EMPTY: never offer "add companion" on
  // an EMPTY/REMOVED cell — GRID's NoActivePlantingError must never fire
  // from normal picker use.
  const canAddCompanion = hasActivePlant && !isHarvested;

  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>): void {
    if (event.key === "Escape" && !isSubmitting) {
      (isOpen ? onCancel : onDeselect)();
    }
  }

  const [primaryPlantId, ...companionPlantIds] = cell.plantIds;
  // Remove is only ever offered on an active, non-harvested cell — a
  // HARVESTED cell's removal is the lifecycle-advance "Clear/Remove cell"
  // pair in HarvestedActions above, a deliberately separate (currently
  // stubbed) concern.
  const canRemovePlant = Boolean(onRemovePlant) && hasActivePlant && !isHarvested;
  const primaryGrowth: GrowthView | null = cell.plantings?.[0]?.growth ?? null;
  const primaryHealthBand = primaryGrowth ? healthBand(primaryGrowth) : null;
  // What the primary planting is receiving FROM its same-cell companions —
  // not attributed back to a specific companion's name, since PlantOption
  // doesn't carry the species key SnapshotCompanionEffect.sourceSpeciesKey
  // would need to match against (see grid-cell-service.ts's
  // companionEffectsForCell for how this was computed server-side).
  const primaryCompanionEffects = cell.plantings?.[0]?.companionEffects ?? [];
  const [harvestPlantingId, setHarvestPlantingId] = useState(cell.plantings?.[0]?.id ?? "");
  const [overridePlantingId, setOverridePlantingId] = useState(cell.plantings?.[0]?.id ?? "");
  const [overrideTargetStage, setOverrideTargetStage] = useState<string>(() =>
    currentOverridableStage(cell, cell.plantings?.[0]?.id ?? ""),
  );
  const [harvestAmount, setHarvestAmount] = useState("1");
  const [harvestUnit, setHarvestUnit] = useState("item");
  const [harvestNotes, setHarvestNotes] = useState("");
  const [cellNoteBody, setCellNoteBody] = useState("");
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [lifecycleMessage, setLifecycleMessage] = useState<string | null>(null);

  const [mulchDepthMm, setMulchDepthMm] = useState("30");
  const [compostAmount, setCompostAmount] = useState("0.5");
  const [fertilizerKind, setFertilizerKind] = useState<"SYNTHETIC" | "ORGANIC">("SYNTHETIC");
  const [fertilizerN, setFertilizerN] = useState("0.2");
  const [fertilizerP, setFertilizerP] = useState("0.1");
  const [fertilizerK, setFertilizerK] = useState("0.1");

  async function runLifecycle(operation: () => Promise<ActionResult>, success: string): Promise<void> {
    setLifecycleBusy(true);
    setLifecycleMessage(null);
    try {
      const result = await operation();
      if (!result.ok) {
        setLifecycleMessage(result.error ?? "Something went wrong.");
        return;
      }
      await onRefresh?.();
      setLifecycleMessage(success);
    } catch {
      setLifecycleMessage("Couldn't reach the server. Try again.");
    } finally {
      setLifecycleBusy(false);
    }
  }

  return (
    <aside
      className="w-full rounded-xl border p-4 sm:p-5"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface-raised)",
        boxShadow: "var(--shadow-card)",
      }}
      aria-label="Cell details"
      aria-busy={isSubmitting}
      onKeyDown={handleKeyDown}
    >
      <header className="mb-5 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>
            {cell.bedName}
          </p>
          <p className="text-xl" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
            Column {cell.column}, row {cell.row}
          </p>
        </div>
        <button
          type="button"
          onClick={onDeselect}
          className={`rounded text-lg leading-none ${FOCUS_RING}`}
          style={{ color: "var(--color-text-muted)" }}
          aria-label="Deselect cell"
        >
          ×
        </button>
      </header>

      {/* A status-report row, not a single sentence: this is the panel's
          at-a-glance answer to "what's here" - status, primary plant, and
          companions each get their own labeled stat instead of being
          folded into one line of prose. */}
      <dl className="mb-5 grid grid-cols-2 gap-x-4 gap-y-4 border-y py-4 sm:grid-cols-3" style={{ borderColor: "var(--color-border)" }}>
        <div>
          <dt className="mb-1 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>
            Status
          </dt>
          <dd className="flex flex-wrap items-center gap-1.5 text-sm font-medium" style={{ color: "var(--color-text)" }}>
            <span aria-hidden="true" className={`inline-block h-3 w-3 shrink-0 rounded-sm border-2 ${STATUS_STYLES[cell.status]}`} />
            {STATUS_WORD[cell.status]}
            {primaryHealthBand && primaryHealthBand !== "healthy" && (
              <span
                className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold"
                style={{ background: "var(--color-warning-bg)", color: "var(--color-warning-text)" }}
              >
                <span aria-hidden="true" className={`inline-block h-1.5 w-1.5 shrink-0 rounded-full ${HEALTH_BAND_CSS[primaryHealthBand]}`} />
                {(() => {
                  const HealthIcon = HEALTH_BAND_ICON[primaryHealthBand];
                  return <HealthIcon aria-hidden="true" className="h-3 w-3" />;
                })()}
                {HEALTH_BAND_LABEL[primaryHealthBand]}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>
            Primary plant
          </dt>
          <dd className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            {primaryPlantId ? (
              <span className="inline-flex items-center gap-1.5">
                <span>{plantName(plants, primaryPlantId)}</span>
                {canRemovePlant && onRemovePlant && (
                  <RemoveButton
                    plantName={plantName(plants, primaryPlantId)}
                    isSubmitting={isSubmitting}
                    onRemove={() => onRemovePlant(primaryPlantId)}
                  />
                )}
              </span>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="mb-1 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>
            Companions ({companionPlantIds.length})
          </dt>
          <dd className="text-sm font-medium" style={{ color: "var(--color-text)" }}>
            {companionPlantIds.length > 0 ? (
              <ul className="flex flex-col gap-1">
                {companionPlantIds.map((id) => (
                  <li key={id} className="inline-flex items-center gap-1.5">
                    <span>{plantName(plants, id)}</span>
                    {canRemovePlant && onRemovePlant && (
                      <RemoveButton
                        plantName={plantName(plants, id)}
                        isSubmitting={isSubmitting}
                        onRemove={() => onRemovePlant(id)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              "—"
            )}
          </dd>
          {primaryCompanionEffects.length > 0 && (
            <ul className="mt-1.5 flex flex-wrap gap-1.5">
              {primaryCompanionEffects.map((effect) => {
                const Icon = COMPANION_EFFECT_ICON[effect.kind];
                return (
                  <li
                    key={effect.kind}
                    className="inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs font-medium"
                    style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
                  >
                    <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />
                    {COMPANION_EFFECT_LABEL[effect.kind]}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </dl>

      {cell.plantIds.length > 0 && !isHarvested && (
        <section className="mb-5 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }} aria-labelledby="lifecycle-heading">
          <h3 id="lifecycle-heading" className="font-semibold">Growth</h3>
          {/* Germination and growth now advance automatically from simulated
              time + weather (src/domain/growth) rather than a manual click —
              this panel reports what the engine is doing instead of driving
              it. */}
          <GrowthReadout growth={cell.plantings?.[0]?.growth ?? null} />
          {overridePlantingStage && cell.plantings?.length ? (
            <div className="mt-3 flex flex-wrap items-end gap-2">
              <label className="text-sm">
                Plant
                <select
                  value={overridePlantingId}
                  onChange={(event) => {
                    const nextPlantingId = event.target.value;
                    setOverridePlantingId(nextPlantingId);
                    // Re-seed the target stage to whichever planting is now
                    // selected — otherwise switching between companions in
                    // this dropdown leaves the previous planting's stage
                    // sitting in "Set stage", the same stale-default trap
                    // this whole change is meant to close.
                    setOverrideTargetStage(currentOverridableStage(cell, nextPlantingId));
                  }}
                  className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  {cell.plantings.map((planting) => (
                    <option key={planting.id} value={planting.id}>
                      {plantName(plants, planting.plantId)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                Set stage
                <select
                  value={overrideTargetStage}
                  onChange={(event) => setOverrideTargetStage(event.target.value)}
                  className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3"
                  style={{ borderColor: "var(--color-border)" }}
                >
                  {OVERRIDABLE_STAGES.map((stage) => (
                    <option key={stage} value={stage}>
                      {PHENOLOGY_LABEL[stage] ?? stage}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={lifecycleBusy}
                onClick={() =>
                  void runLifecycle(
                    () => overridePlantingStage({ cellPlantingId: overridePlantingId, targetStage: overrideTargetStage }),
                    "Growth stage updated.",
                  )
                }
                className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`}
                style={{ borderColor: "var(--color-border)" }}
              >
                Set stage
              </button>
            </div>
          ) : null}
          {advancePlanting && cell.status === "GROWING" && recordHarvest && cell.plantings?.length ? (
            <form
              className="mt-3 grid gap-2 sm:grid-cols-2"
              onSubmit={(event) => {
                event.preventDefault();
                void runLifecycle(
                  () => recordHarvest({
                    cellPlantingId: harvestPlantingId,
                    amount: Number(harvestAmount),
                    unit: harvestUnit,
                    notes: harvestNotes,
                  }),
                  "Harvest recorded. The plant remains growing.",
                );
              }}
            >
              <label className="text-sm sm:col-span-2">
                Plant
                <select value={harvestPlantingId} onChange={(event) => setHarvestPlantingId(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3" style={{ borderColor: "var(--color-border)" }}>
                  {cell.plantings.map((planting) => (
                    <option key={planting.id} value={planting.id}>
                      {plantName(plants, planting.plantId)} ({planting.harvestCount} harvest{planting.harvestCount === 1 ? "" : "s"})
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">Amount<input type="number" min="0.01" step="any" value={harvestAmount} onChange={(event) => setHarvestAmount(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3" style={{ borderColor: "var(--color-border)" }} /></label>
              <label className="text-sm">Unit<input value={harvestUnit} onChange={(event) => setHarvestUnit(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3" style={{ borderColor: "var(--color-border)" }} /></label>
              <label className="text-sm sm:col-span-2">Notes<input value={harvestNotes} onChange={(event) => setHarvestNotes(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3" style={{ borderColor: "var(--color-border)" }} /></label>
              <div className="flex flex-wrap gap-2 sm:col-span-2">
                <button type="submit" disabled={lifecycleBusy} className={`rounded-md bg-[var(--color-cta-bg)] px-3 font-semibold text-[var(--color-cta-text)] ${MIN_TOUCH_TARGET}`}>Record harvest</button>
                <button type="button" disabled={lifecycleBusy} onClick={() => void runLifecycle(() => advancePlanting({ bedId: cell.bedId, column: cell.column, row: cell.row }, "finish"), "Planting marked finished.")} className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`} style={{ borderColor: "var(--color-border)" }}>Finish planting</button>
              </div>
            </form>
          ) : null}
          {lifecycleMessage && <p role="status" className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>{lifecycleMessage}</p>}
        </section>
      )}

      {cell.plantIds.length > 0 && !isHarvested && (applyMulch || applyCompost || applyFertilizer || applyFungicide || applyWeeding) && (
        <section className="mb-5 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }} aria-labelledby="care-heading">
          <h3 id="care-heading" className="font-semibold">Care</h3>
          <SoilCard environment={cell.environment ?? null} soilProfile={cell.soilProfile} />
          <InfectionReadout plantings={cell.plantings} />
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {applyMulch && (
              <div className="flex flex-col gap-2">
                <label className="text-sm">
                  Mulch depth (mm)
                  <input
                    type="number"
                    min="0"
                    max="150"
                    value={mulchDepthMm}
                    onChange={(event) => setMulchDepthMm(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3"
                    style={{ borderColor: "var(--color-border)" }}
                  />
                </label>
                <button
                  type="button"
                  disabled={lifecycleBusy}
                  onClick={() =>
                    void runLifecycle(
                      () => applyMulch({ bedId: cell.bedId, column: cell.column, row: cell.row, depthMm: Number(mulchDepthMm) }),
                      "Mulch applied.",
                    )
                  }
                  className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`}
                  style={{ borderColor: "var(--color-border)" }}
                >
                  Apply mulch
                </button>
              </div>
            )}
            {applyCompost && (
              <div className="flex flex-col gap-2">
                <label className="text-sm">
                  Compost amount
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={compostAmount}
                    onChange={(event) => setCompostAmount(event.target.value)}
                    className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3"
                    style={{ borderColor: "var(--color-border)" }}
                  />
                </label>
                <button
                  type="button"
                  disabled={lifecycleBusy}
                  onClick={() =>
                    void runLifecycle(
                      () => applyCompost({ bedId: cell.bedId, column: cell.column, row: cell.row, amount: Number(compostAmount) }),
                      "Compost added — releases slowly over time.",
                    )
                  }
                  className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`}
                  style={{ borderColor: "var(--color-border)" }}
                >
                  Add compost
                </button>
              </div>
            )}
            {applyFertilizer && (
              <div className="flex flex-col gap-2">
                <label className="text-sm">
                  Fertilizer
                  <select
                    value={fertilizerKind}
                    onChange={(event) => setFertilizerKind(event.target.value as "SYNTHETIC" | "ORGANIC")}
                    className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3"
                    style={{ borderColor: "var(--color-border)" }}
                  >
                    <option value="SYNTHETIC">Synthetic (fast, leaches easily)</option>
                    <option value="ORGANIC">Organic (slow-release)</option>
                  </select>
                </label>
                <div className="grid grid-cols-3 gap-1.5">
                  <label className="text-xs">N<input type="number" min="0" max="0.5" step="0.05" value={fertilizerN} onChange={(event) => setFertilizerN(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-2" style={{ borderColor: "var(--color-border)" }} /></label>
                  <label className="text-xs">P<input type="number" min="0" max="0.5" step="0.05" value={fertilizerP} onChange={(event) => setFertilizerP(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-2" style={{ borderColor: "var(--color-border)" }} /></label>
                  <label className="text-xs">K<input type="number" min="0" max="0.5" step="0.05" value={fertilizerK} onChange={(event) => setFertilizerK(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-2" style={{ borderColor: "var(--color-border)" }} /></label>
                </div>
                <button
                  type="button"
                  disabled={lifecycleBusy}
                  onClick={() =>
                    void runLifecycle(
                      () =>
                        applyFertilizer({
                          bedId: cell.bedId,
                          column: cell.column,
                          row: cell.row,
                          kind: fertilizerKind,
                          n: Number(fertilizerN),
                          p: Number(fertilizerP),
                          k: Number(fertilizerK),
                        }),
                      "Fertilizer applied.",
                    )
                  }
                  className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`}
                  style={{ borderColor: "var(--color-border)" }}
                >
                  Apply fertilizer
                </button>
              </div>
            )}
            {applyFungicide && (
              <div className="flex flex-col gap-2">
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  Knocks down active infections on this cell — a real treatment, not an instant cure.
                </p>
                <button
                  type="button"
                  disabled={lifecycleBusy}
                  onClick={() =>
                    void runLifecycle(
                      () => applyFungicide({ bedId: cell.bedId, column: cell.column, row: cell.row }),
                      "Fungicide applied.",
                    )
                  }
                  className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`}
                  style={{ borderColor: "var(--color-border)" }}
                >
                  Apply fungicide
                </button>
              </div>
            )}
            {applyWeeding && (
              <div className="flex flex-col gap-2">
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
                  Knocks back weed pressure — a real reduction, not a reset to zero.
                </p>
                <button
                  type="button"
                  disabled={lifecycleBusy}
                  onClick={() =>
                    void runLifecycle(
                      () => applyWeeding({ bedId: cell.bedId, column: cell.column, row: cell.row }),
                      "Weeded.",
                    )
                  }
                  className={`rounded-md border px-3 ${MIN_TOUCH_TARGET}`}
                  style={{ borderColor: "var(--color-border)" }}
                >
                  Apply weeding
                </button>
              </div>
            )}
          </div>
          {lifecycleMessage && <p role="status" className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>{lifecycleMessage}</p>}
        </section>
      )}

      {createJournalNote && (
        <section className="mb-5 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }} aria-labelledby="cell-note-heading">
          <h3 id="cell-note-heading" className="font-semibold">Add a note about this cell</h3>
          <form
            className="mt-2 flex flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              const formData = new FormData();
              formData.set("body", cellNoteBody);
              formData.set("bedId", cell.bedId);
              formData.set("column", String(cell.column));
              formData.set("row", String(cell.row));
              void runLifecycle(
                () =>
                  createJournalNote(formData).then((result) => {
                    if (result.ok) setCellNoteBody("");
                    return result;
                  }),
                "Note added.",
              );
            }}
          >
            <label className="text-sm" htmlFor="cell-note-body">Note</label>
            <textarea
              id="cell-note-body"
              value={cellNoteBody}
              onChange={(event) => setCellNoteBody(event.target.value)}
              rows={2}
              placeholder="Aphids showed up here today…"
              className="min-h-11 w-full rounded-md border bg-[var(--color-surface)] px-3 py-2"
              style={{ borderColor: "var(--color-border)" }}
            />
            <button
              type="submit"
              disabled={lifecycleBusy || !cellNoteBody.trim()}
              className={`self-start rounded-md border px-3 ${MIN_TOUCH_TARGET}`}
              style={{ borderColor: "var(--color-border)" }}
            >
              Save note
            </button>
          </form>
          {lifecycleMessage && <p role="status" className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>{lifecycleMessage}</p>}
        </section>
      )}

      {isSubmitting && (
        <p className="mb-4 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Saving…
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-md px-3 py-2 text-sm"
          style={{ background: "var(--color-danger-bg)", color: "var(--color-danger-text)" }}
        >
          {error}
        </p>
      )}

      {!isOpen && (
        <button
          type="button"
          onClick={onOpen}
          className={`rounded-md px-4 ${MIN_TOUCH_TARGET} text-sm font-semibold shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md ${FOCUS_RING}`}
          style={{ background: "var(--color-cta-bg)", color: "var(--color-cta-text)" }}
        >
          {isHarvested ? "View options" : hasActivePlant ? "Change plant" : "Assign plant"}
        </button>
      )}

      {isOpen && isHarvested && <HarvestedActions onCancel={onCancel} />}

      {isOpen && !isHarvested && (
        <PlantOptionsList
          cell={cell}
          plants={plants}
          isSubmitting={isSubmitting}
          hasActivePlant={hasActivePlant}
          canAddCompanion={canAddCompanion}
          onAssign={onAssign}
          onAddCompanion={onAddCompanion}
          onCancel={onCancel}
        />
      )}
    </aside>
  );
}

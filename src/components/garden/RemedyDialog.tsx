"use client";

// Per-cell remedy guidance, opened from NeedsAttentionBanner's "View fix"
// button. Real-world steps are always shown first — the in-app "Apply"
// button (when one exists at all; cold/wind/transplantShock never get one,
// see remedy-guidance.ts) is a mirror of the same fix, not a replacement
// for it, since the underlying plant is real and this app can't actually
// change the weather.
//
// Imports and calls its server action directly rather than receiving it as
// a prop — same convention ConditionsPanel.tsx and PestPanel.tsx already
// use for actions that aren't part of CellPicker's existing prop-drilled
// care-action set.

import { useEffect, useRef, useState } from "react";
import {
  applyFertilizerAction,
  applyFungicideAction,
  installConditionOverrideAction,
  waterCellAction,
} from "@/app/actions";
import { STRESS_DIAL_LABEL } from "./stress-display";
import { getRemedy, REMEDY_CONDITION_INTENSITY, REMEDY_FERTILIZER_NPK, type RemedyAction } from "./remedy-guidance";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";

export interface RemedyDialogTarget {
  bedId: string;
  bedName: string;
  column: number;
  row: number;
  dial: string;
  hasActiveInfection: boolean;
}

export interface RemedyDialogProps {
  target: RemedyDialogTarget;
  onClose: () => void;
  onApplied: () => Promise<void>;
  onOpenIrrigationSettings: () => void;
}

type FertilizerKind = "SYNTHETIC" | "ORGANIC";

// Shown alongside the fertilize action so the choice of immediate-vs-slow
// is explicit rather than silently hardcoded (see care-actions-service.ts:
// SYNTHETIC hits the N/P/K pools directly and clears nutrient stress on the
// next refresh; ORGANIC joins the slow-release residue pool and only
// becomes available over subsequent simulated days via decomposition).
const FERTILIZER_KIND_COPY: Record<FertilizerKind, { label: string; description: string }> = {
  SYNTHETIC: {
    label: "Synthetic — fixes it now",
    description: "Feeds the plant immediately. Leaches out fast if it rains soon after applying.",
  },
  ORGANIC: {
    label: "Organic — slow release",
    description:
      "Gentler on the soil, but breaks down over several simulated days before the plant can use it — this cell will likely still show as stressed right after applying.",
  },
};

async function runAction(
  action: Exclude<RemedyAction, { kind: "open-irrigation" }>,
  target: RemedyDialogTarget,
  fertilizerKind: FertilizerKind,
) {
  const { bedId, column, row } = target;
  switch (action.kind) {
    case "water":
      return waterCellAction({ bedId, column, row });
    case "shade-cloth":
      return installConditionOverrideAction({ bedId, kind: "SHADE_CLOTH", intensity: REMEDY_CONDITION_INTENSITY });
    case "grow-light":
      return installConditionOverrideAction({ bedId, kind: "GROW_LIGHT", intensity: REMEDY_CONDITION_INTENSITY });
    case "fertilize":
      return applyFertilizerAction({ bedId, column, row, kind: fertilizerKind, ...REMEDY_FERTILIZER_NPK });
    case "fungicide":
      return applyFungicideAction({ bedId, column, row });
  }
}

const ACTION_BUTTON_LABEL: Record<Exclude<RemedyAction["kind"], "fertilize">, string> = {
  water: "Water this cell now",
  "shade-cloth": "Install shade cloth",
  "grow-light": "Install a grow light",
  fungicide: "Apply fungicide",
  "open-irrigation": "Open Irrigation Settings",
};

export function RemedyDialog({ target, onClose, onApplied, onOpenIrrigationSettings }: RemedyDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fertilizerKind, setFertilizerKind] = useState<FertilizerKind>("SYNTHETIC");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    dialogRef.current?.focus();
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const remedy = getRemedy(target.dial, target.hasActiveInfection);
  const dialLabel = STRESS_DIAL_LABEL[target.dial] ?? target.dial;

  async function handleApply(): Promise<void> {
    const action = remedy.action;
    if (!action || isSubmitting) return;
    if (action.kind === "open-irrigation") {
      onOpenIrrigationSettings();
      onClose();
      return;
    }
    setIsSubmitting(true);
    setError(null);
    try {
      const result = await runAction(action, target, fertilizerKind);
      if (!result.ok) {
        setError(result.error ?? "Couldn't apply that fix.");
        return;
      }
      await onApplied();
      onClose();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="remedy-dialog-heading"
        tabIndex={-1}
        className="w-full max-w-md rounded-xl border bg-[var(--color-surface-raised)] p-5 shadow-xl"
        style={{ borderColor: "var(--color-border)" }}
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="remedy-dialog-heading" className="text-base font-semibold" style={{ color: "var(--color-text)" }}>
          {remedy.headline}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
          {target.bedName}, column {target.column}, row {target.row} · {dialLabel}
        </p>
        <ol className="mt-3 flex flex-col gap-1.5 text-sm" style={{ color: "var(--color-text)" }}>
          {remedy.steps.map((step, index) => (
            <li key={step} className="flex gap-2">
              <span aria-hidden="true" style={{ color: "var(--color-text-muted)" }}>
                {index + 1}.
              </span>
              {step}
            </li>
          ))}
        </ol>
        {!remedy.action && (
          <p className="mt-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
            No in-app fix for this — follow the steps above in the real garden.
          </p>
        )}
        {remedy.action?.kind === "fertilize" && (
          <fieldset className="mt-4 flex flex-col gap-2">
            <legend className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>
              Fertilizer type
            </legend>
            {(Object.keys(FERTILIZER_KIND_COPY) as FertilizerKind[]).map((kind) => (
              <label
                key={kind}
                className="flex cursor-pointer items-start gap-2 rounded-md border p-2 text-sm"
                style={{
                  borderColor: fertilizerKind === kind ? "var(--color-accent-strong)" : "var(--color-border)",
                }}
              >
                <input
                  type="radio"
                  name="fertilizer-kind"
                  value={kind}
                  checked={fertilizerKind === kind}
                  onChange={() => setFertilizerKind(kind)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block font-medium" style={{ color: "var(--color-text)" }}>
                    {FERTILIZER_KIND_COPY[kind].label}
                  </span>
                  <span className="block text-xs" style={{ color: "var(--color-text-muted)" }}>
                    {FERTILIZER_KIND_COPY[kind].description}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
        {error && (
          <p role="alert" className="mt-3 text-sm" style={{ color: "var(--color-danger-text)" }}>
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} rounded-md border px-3 text-sm font-medium`}
            style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
          >
            {remedy.action ? "Cancel" : "Got it"}
          </button>
          {remedy.action && (
            <button
              type="button"
              onClick={() => void handleApply()}
              disabled={isSubmitting}
              className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} rounded-md px-3 text-sm font-semibold text-white disabled:opacity-60`}
              style={{ background: "var(--color-accent-strong)" }}
            >
              {isSubmitting
                ? "Applying…"
                : remedy.action.kind === "fertilize"
                  ? `Apply ${fertilizerKind === "SYNTHETIC" ? "synthetic" : "organic"} fertilizer`
                  : ACTION_BUTTON_LABEL[remedy.action.kind]}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

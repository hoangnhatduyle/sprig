"use client";

// Season Recap sub-view, nested inside JournalPanel's inner tablist. A
// date-range aggregation built on getGardenJournal via getSeasonRecapAction.
// Export is zero-new-dependency by design: a `data-print-recap` region plus
// a `@media print` stylesheet (src/app/globals.css) and a plain
// window.print() button, rather than pulling in a PDF library.

import { useState } from "react";
import { getSeasonRecapAction, startNewSeasonAction, type StartNewSeasonResult } from "@/app/actions";
import type { SeasonRecap } from "@/domain/journal/season-recap-service";
import { JOURNAL_KIND_LABEL } from "./journal-display";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import type { SnapshotBed } from "./types";

export interface SeasonRecapPanelProps {
  beds: SnapshotBed[];
  disabled?: boolean;
  getRecap?: (sinceIso: string, untilIso: string) => Promise<SeasonRecap | null>;
  startNewSeason?: (note?: string) => Promise<StartNewSeasonResult>;
  // Called after a successful reset so the parent can refresh the journal
  // feed and the garden grid — SeasonRecapPanel itself only owns the recap
  // view's local state.
  onSeasonReset?: () => Promise<void>;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultSince(): string {
  const date = new Date();
  date.setDate(date.getDate() - 90);
  return isoDate(date);
}

export function SeasonRecapPanel({
  disabled = false,
  getRecap = getSeasonRecapAction,
  startNewSeason = startNewSeasonAction,
  onSeasonReset,
}: SeasonRecapPanelProps) {
  const [since, setSince] = useState(defaultSince());
  const [until, setUntil] = useState(isoDate(new Date()));
  const [recap, setRecap] = useState<SeasonRecap | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resetBusy, setResetBusy] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  async function handleGenerate(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const result = await getRecap(new Date(since).toISOString(), new Date(`${until}T23:59:59.999`).toISOString());
      if (!result) {
        setError("Choose a valid date range.");
        return;
      }
      setRecap(result);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleStartNewSeason(): Promise<void> {
    if (resetBusy) return;
    const confirmed = window.confirm(
      "Start a new season? Every planted crop will be cleared back to empty soil, and " +
        "pest/disease/soil state resets to baseline. Recorded history (harvests, notes, " +
        "care actions) stays intact and this season's activity remains in past recaps. " +
        "Bed layout, equipment, and your plant catalog are not affected. This can't be undone.",
    );
    if (!confirmed) return;

    setResetBusy(true);
    setResetMessage(null);
    try {
      const result = await startNewSeason();
      if (!result.ok) {
        setResetMessage(result.error ?? "Couldn't start a new season.");
        return;
      }
      setResetMessage(
        `New season started: ${result.plantingsClosed ?? 0} planting(s) cleared, ` +
          `${result.cellsCleared ?? 0} cell(s) reset to empty.`,
      );
      await onSeasonReset?.();
    } catch {
      setResetMessage("Couldn't reach the server. Try again.");
    } finally {
      setResetBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 print:hidden">
        <label className="text-sm font-medium">
          From
          <input
            type="date"
            value={since}
            onChange={(event) => setSince(event.target.value)}
            disabled={disabled || busy}
            className={`mt-1 block ${MIN_TOUCH_TARGET} rounded-md border bg-[var(--color-surface)] px-3 text-sm`}
            style={{ borderColor: "var(--color-border)" }}
          />
        </label>
        <label className="text-sm font-medium">
          To
          <input
            type="date"
            value={until}
            onChange={(event) => setUntil(event.target.value)}
            disabled={disabled || busy}
            className={`mt-1 block ${MIN_TOUCH_TARGET} rounded-md border bg-[var(--color-surface)] px-3 text-sm`}
            style={{ borderColor: "var(--color-border)" }}
          />
        </label>
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={disabled || busy}
          className={`${MIN_TOUCH_TARGET} rounded-md bg-[var(--color-cta-bg)] px-4 text-sm font-semibold text-[var(--color-cta-text)] disabled:opacity-50 ${FOCUS_RING}`}
        >
          {busy ? "Generating…" : "Generate recap"}
        </button>
        {recap && (
          <button
            type="button"
            onClick={() => window.print()}
            className={`${MIN_TOUCH_TARGET} rounded-md border px-4 text-sm font-semibold ${FOCUS_RING}`}
            style={{ borderColor: "var(--color-border)" }}
          >
            Print / Export
          </button>
        )}
      </div>

      {error && <p role="alert" className="text-sm" style={{ color: "var(--color-danger-text)" }}>{error}</p>}

      <div
        className="flex flex-wrap items-center gap-3 rounded-lg border p-3 print:hidden"
        style={{ borderColor: "var(--color-danger-text)", background: "var(--color-danger-bg)" }}
      >
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold" style={{ color: "var(--color-danger-text)" }}>Start a new season</p>
          <p className="text-xs" style={{ color: "var(--color-danger-text)" }}>
            Clears every planted crop and live pest/disease/soil state back to empty. Recorded history stays intact.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void handleStartNewSeason()}
          disabled={disabled || resetBusy}
          className={`${MIN_TOUCH_TARGET} shrink-0 rounded-md border px-4 text-sm font-semibold disabled:opacity-50 ${FOCUS_RING}`}
          style={{ borderColor: "var(--color-danger-text)", color: "var(--color-danger-text)" }}
        >
          {resetBusy ? "Starting…" : "Start New Season"}
        </button>
      </div>
      {resetMessage && <p role="status" className="text-sm" style={{ color: "var(--color-danger-text)" }}>{resetMessage}</p>}

      {recap && (
        <div data-print-recap className="flex flex-col gap-4">
          <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
            {new Date(recap.sinceIso).toLocaleDateString()} – {new Date(recap.untilIso).toLocaleDateString()}
          </p>

          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>Recorded activity</dt>
              <dd className="text-2xl" style={{ fontFamily: "var(--font-display)" }}>{recap.totalEntries}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>Harvests logged</dt>
              <dd className="text-2xl" style={{ fontFamily: "var(--font-display)" }}>{recap.entriesByKind.HARVEST}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>Most active bed</dt>
              <dd className="text-lg">{recap.mostActiveBed ? `${recap.mostActiveBed.bedName} (${recap.mostActiveBed.entryCount})` : "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-text-muted)" }}>Unresolved disease episodes</dt>
              <dd className="text-2xl" style={{ fontFamily: "var(--font-display)" }}>{recap.unresolvedDiseaseEpisodes}</dd>
            </div>
          </dl>

          {recap.largestHarvest && (
            <p className="text-sm">
              Biggest single harvest: <strong>{recap.largestHarvest.amount} {recap.largestHarvest.unit} of {recap.largestHarvest.plantName}</strong> from {recap.largestHarvest.bedName}.
            </p>
          )}

          {recap.harvestTotals.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-semibold">Harvest totals</h3>
              <ul className="flex flex-col gap-1">
                {recap.harvestTotals.map((total) => (
                  <li key={`${total.plantId}:${total.unit}`} className="text-sm">
                    {total.plantName}: {total.amount} {total.unit}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h3 className="mb-2 text-sm font-semibold">Activity by kind</h3>
            <ul className="flex flex-wrap gap-2">
              {(Object.keys(recap.entriesByKind) as (keyof typeof recap.entriesByKind)[])
                .filter((kind) => recap.entriesByKind[kind] > 0)
                .map((kind) => (
                  <li key={kind} className="rounded-full border px-2 py-0.5 text-xs" style={{ borderColor: "var(--color-border)" }}>
                    {kind === "CARE_ACTION" ? "Care actions" : JOURNAL_KIND_LABEL[kind]}: {recap.entriesByKind[kind]}
                  </li>
                ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}

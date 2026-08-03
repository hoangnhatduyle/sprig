"use client";

// Trends tab container — owns date-range + bed/plant filter state and calls
// the two Trends server actions on demand. Modeled directly on
// SeasonRecapPanel.tsx's date-range/Generate/busy/error pattern rather than
// preloading from page.tsx, since this is the same shape of feature
// (aggregate a range on request) that panel already solved.

import { useState } from "react";
import { getWeatherTrendAction, getYieldTrendAction } from "@/app/actions";
import type { WeatherDayView } from "@/domain/weather/weather-service";
import type { YieldTrendPoint } from "@/domain/journal/yield-trend-service";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import { WeatherTrendChart } from "./WeatherTrendChart";
import { YieldTrendChart } from "./YieldTrendChart";
import type { InventorySnapshot } from "@/domain/plant-catalog/inventory-service";
import type { SnapshotBed } from "./types";

export interface TrendsPanelProps {
  beds: SnapshotBed[];
  inventory: InventorySnapshot;
  disabled?: boolean;
  bare?: boolean;
  getYieldTrend?: typeof getYieldTrendAction;
  getWeatherTrend?: typeof getWeatherTrendAction;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function defaultSince(): string {
  const date = new Date();
  date.setDate(date.getDate() - 90);
  return isoDate(date);
}

export function TrendsPanel({
  beds,
  inventory,
  disabled = false,
  bare = false,
  getYieldTrend = getYieldTrendAction,
  getWeatherTrend = getWeatherTrendAction,
}: TrendsPanelProps) {
  const [since, setSince] = useState(defaultSince());
  const [until, setUntil] = useState(isoDate(new Date()));
  const [bedId, setBedId] = useState("");
  const [plantId, setPlantId] = useState("");
  const [yieldTrend, setYieldTrend] = useState<YieldTrendPoint[] | null>(null);
  const [weatherTrend, setWeatherTrend] = useState<WeatherDayView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const sinceIso = new Date(since).toISOString();
      const untilIso = new Date(`${until}T23:59:59.999`).toISOString();
      const [yieldResult, weatherResult] = await Promise.all([
        getYieldTrend({ sinceIso, untilIso, bedId: bedId || undefined, plantId: plantId || undefined }),
        getWeatherTrend(sinceIso, untilIso),
      ]);
      if (!yieldResult || !weatherResult) {
        setError("Choose a valid date range.");
        return;
      }
      setYieldTrend(yieldResult);
      setWeatherTrend(weatherResult);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const Wrapper = bare ? "div" : "section";

  return (
    <Wrapper
      className={bare ? "flex flex-col gap-4" : "flex flex-col gap-4 rounded-xl border p-4 sm:p-5"}
      style={
        bare
          ? undefined
          : { borderColor: "var(--color-border)", background: "var(--color-surface-raised)", boxShadow: "var(--shadow-card)" }
      }
    >
      <div className="flex flex-wrap items-end gap-3">
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
        <label className="text-sm font-medium">
          Bed
          <select
            value={bedId}
            onChange={(event) => setBedId(event.target.value)}
            disabled={disabled || busy}
            className={`mt-1 block ${MIN_TOUCH_TARGET} rounded-md border bg-[var(--color-surface)] px-3 text-sm`}
            style={{ borderColor: "var(--color-border)" }}
          >
            <option value="">All beds</option>
            {beds.map((bed) => (
              <option key={bed.id} value={bed.id}>
                {bed.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm font-medium">
          Plant
          <select
            value={plantId}
            onChange={(event) => setPlantId(event.target.value)}
            disabled={disabled || busy}
            className={`mt-1 block ${MIN_TOUCH_TARGET} rounded-md border bg-[var(--color-surface)] px-3 text-sm`}
            style={{ borderColor: "var(--color-border)" }}
          >
            <option value="">All plants</option>
            {inventory.seeds.map((plant) => (
              <option key={plant.id} value={plant.id}>
                {plant.commonName}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={disabled || busy}
          className={`${MIN_TOUCH_TARGET} rounded-md bg-[var(--color-cta-bg)] px-4 text-sm font-semibold text-[var(--color-cta-text)] disabled:opacity-50 ${FOCUS_RING}`}
        >
          {busy ? "Loading…" : "Generate"}
        </button>
      </div>

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--color-danger-text)" }}>
          {error}
        </p>
      )}

      {yieldTrend && <YieldTrendChart data={yieldTrend} bare={bare} />}
      {weatherTrend && <WeatherTrendChart data={weatherTrend} bare={bare} />}
    </Wrapper>
  );
}

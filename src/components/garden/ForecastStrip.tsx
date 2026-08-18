"use client";

// A 7-day-ahead companion to WeatherBanner ("today"), rendered directly
// beneath it in GardenTopTabs' "Today" tab (see GardenSnapshot.environment.forecast,
// backed by getForecastView in src/domain/weather/weather-service.ts).
//
// Two interchangeable views over the same forecast data — ForecastCardList
// (a scannable card per day) and ForecastChartRows (a curved hi/lo
// temperature chart, the whole week's shape at a glance) — toggled here
// like GardenTopTabs' own tabs (same role="tablist" pattern), since neither
// view is strictly better: cards read well standalone, the chart reads well
// as a trend.

import { useState } from "react";
import type { WeatherDayView } from "@/domain/weather/weather-service";
import { ForecastCardList } from "./ForecastCardList";
import { ForecastChartRows } from "./ForecastChartRows";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import { useHydrated } from "./use-hydrated";

const VIEWS = [
  { id: "card", label: "Card" },
  { id: "chart", label: "Chart" },
] as const;

type ViewId = (typeof VIEWS)[number]["id"];

export interface ForecastStripProps {
  forecast: WeatherDayView[];
  // Mirrors WeatherBanner's own `bare` prop — nests inside GardenTopTabs'
  // "Today" tab, which already supplies the card chrome.
  bare?: boolean;
}

export function ForecastStrip({ forecast, bare = false }: ForecastStripProps) {
  const hydrated = useHydrated();
  const [view, setView] = useState<ViewId>("card");

  if (forecast.length === 0) {
    return null;
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
      aria-labelledby="forecast-heading"
    >
      {!bare && (
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--color-clay-strong)" }}>
          Coming up
        </p>
      )}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="forecast-heading" className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
          7-day forecast
        </h2>
        <div className="flex gap-1" role="tablist" aria-label="Forecast view">
          {VIEWS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`forecast-view-${id}-tab`}
              aria-selected={view === id}
              aria-controls={`forecast-view-${id}-panel`}
              onClick={() => setView(id)}
              className={`${MIN_TOUCH_TARGET} rounded-md border px-3 text-xs font-semibold ${FOCUS_RING}`}
              style={{
                borderColor: view === id ? "var(--color-accent)" : "var(--color-border)",
                background: view === id ? "var(--color-surface)" : "transparent",
                color: "var(--color-text)",
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Unmounted rather than `hidden` (unlike GardenTopTabs' own tabs) —
          neither view holds local state worth preserving across a switch,
          so there's no reason to keep the inactive one's chart/SVG mounted
          and duplicated in the DOM. */}
      {view === "card" ? (
        <div id="forecast-view-card-panel" role="tabpanel" aria-labelledby="forecast-view-card-tab">
          <ForecastCardList forecast={forecast} hydrated={hydrated} />
        </div>
      ) : (
        <div id="forecast-view-chart-panel" role="tabpanel" aria-labelledby="forecast-view-chart-tab">
          <ForecastChartRows forecast={forecast} hydrated={hydrated} />
        </div>
      )}
    </Wrapper>
  );
}

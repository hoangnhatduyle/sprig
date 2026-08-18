"use client";

// A 7-day-ahead companion to WeatherBanner ("today"), rendered directly
// beneath it in GardenTopTabs' "Today" tab (see GardenSnapshot.environment.forecast,
// backed by getForecastView in src/domain/weather/weather-service.ts). Reuses
// WeatherBanner's own CONDITION_ICON/CONDITION_LABEL maps and hydration-safe
// date-formatting approach instead of redefining either.

import { Cloud, Droplets, Snowflake } from "lucide-react";
import type { WeatherDayView } from "@/domain/weather/weather-service";
import { ForecastTempChart } from "./ForecastTempChart";
import { CONDITION_ICON, CONDITION_LABEL } from "./WeatherBanner";
import { useHydrated } from "./use-hydrated";

// `date` crosses a Server Action / RSC boundary typed as Date but this
// project's other cross-boundary timestamps (simTimeIso, sunriseIso,
// sunsetIso in GardenEnvironmentView) are deliberately plain ISO strings —
// coercing defensively here tolerates either representation without relying
// on which one the wire format actually produces.
function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatDayLabel(date: Date, useLocalZone: boolean): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: useLocalZone ? undefined : "UTC",
  });
}

export interface ForecastStripProps {
  forecast: WeatherDayView[];
  // Mirrors WeatherBanner's own `bare` prop — nests inside GardenTopTabs'
  // "Today" tab, which already supplies the card chrome.
  bare?: boolean;
}

// Per-condition accent, reusing hues the app already assigns meaning to
// rather than inventing a new palette: clay (warm terracotta) reads as
// "sun" and already anchors CTAs/highlights here, the rain-barrel teal
// already means "water" (SPEC-IRRIGATION-001), and snow keeps the
// SIMULATION-adjacent plum it had before this pass — every hue was already
// spoken for, so weather borrows meaning instead of adding a competing one.
const CONDITION_ACCENT: Record<string, string> = {
  CLEAR: "var(--color-clay-strong)",
  PARTLY_CLOUDY: "var(--color-clay)",
  CLOUDY: "var(--color-text-muted)",
  RAIN: "var(--rainbarrel-fill)",
  STORM: "var(--rainbarrel-full-border)",
};

export function ForecastStrip({ forecast, bare = false }: ForecastStripProps) {
  const hydrated = useHydrated();

  if (forecast.length === 0) {
    return null;
  }

  const gridStyle = { gridTemplateColumns: `repeat(${forecast.length}, minmax(0, 1fr))` };
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
      <h2 id="forecast-heading" className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        7-day forecast
      </h2>

      {/* Day-label row */}
      <div className="grid gap-1" style={gridStyle}>
        {forecast.map((day) => (
          <span
            key={toDate(day.date).toISOString()}
            className="text-center text-[11px] font-bold uppercase tracking-wide"
            style={{ color: "var(--color-text-muted)" }}
          >
            {formatDayLabel(toDate(day.date), hydrated)}
          </span>
        ))}
      </div>

      {/* Condition icon + word row — the day's main weather at a glance,
          same job the reference's icon strip does above its temperature
          curves. */}
      <div className="mt-1 grid gap-1" style={gridStyle}>
        {forecast.map((day) => {
          const date = toDate(day.date);
          const ConditionIcon = CONDITION_ICON[day.condition] ?? Cloud;
          const accent = day.isSnowDay ? "var(--color-sim-ink)" : (CONDITION_ACCENT[day.condition] ?? "var(--color-text-muted)");
          return (
            <div key={date.toISOString()} className="flex flex-col items-center gap-0.5">
              <ConditionIcon aria-hidden="true" className="h-5 w-5 shrink-0" style={{ color: accent }} />
              <span className="text-center text-[10px] leading-tight text-nowrap" style={{ color: "var(--color-text-muted)" }}>
                {CONDITION_LABEL[day.condition] ?? day.condition}
              </span>
              <span className="sr-only">
                {Math.round(day.tempLowC)}° – {Math.round(day.tempHighC)}°C
              </span>
            </div>
          );
        })}
      </div>

      {/* Two curved lines on one shared temperature scale — high in clay,
          low in the rain-barrel teal — so the week's shape (a hot stretch,
          a cold snap) reads at a glance instead of requiring seven separate
          number comparisons. */}
      <ForecastTempChart
        days={forecast.map((day) => ({ tempHighC: day.tempHighC, tempLowC: day.tempLowC, isSnowDay: day.isSnowDay }))}
      />

      {/* Precipitation + snow/estimated badges, one column per day beneath
          its point on the chart. */}
      <div className="mt-1 grid gap-1" style={gridStyle}>
        {forecast.map((day) => {
          const date = toDate(day.date);
          return (
            <div key={date.toISOString()} className="flex min-h-[1.25rem] flex-col items-center justify-start gap-1">
              {day.precipitationMm > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[10px]" style={{ color: "var(--rainbarrel-fill)" }}>
                  <Droplets aria-hidden="true" className="h-3 w-3 shrink-0" />
                  {Math.round(day.precipitationMm)}mm
                </span>
              )}
              {day.isSnowDay && (
                <span
                  className="inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: "var(--color-sim-bg)", color: "var(--color-sim-ink)" }}
                >
                  <Snowflake aria-hidden="true" className="h-3 w-3 shrink-0" />
                  Snow
                </span>
              )}
              {day.source === "PROCEDURAL" && (
                <span className="text-[9px]" style={{ color: "var(--color-text-muted)" }}>
                  Estimated
                </span>
              )}
            </div>
          );
        })}
      </div>
    </Wrapper>
  );
}

"use client";

// A 7-day-ahead companion to WeatherBanner ("today"), rendered directly
// beneath it in GardenTopTabs' "Today" tab (see GardenSnapshot.environment.forecast,
// backed by getForecastView in src/domain/weather/weather-service.ts). Reuses
// WeatherBanner's own CONDITION_ICON/CONDITION_LABEL maps and hydration-safe
// date-formatting approach instead of redefining either.

import { Cloud, Droplets, Snowflake } from "lucide-react";
import type { WeatherDayView } from "@/domain/weather/weather-service";
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

export function ForecastStrip({ forecast, bare = false }: ForecastStripProps) {
  const hydrated = useHydrated();

  if (forecast.length === 0) {
    return null;
  }

  // A shared min/max across the whole week turns each day's hi/lo into a
  // positioned bar segment on one scale, so the week's shape (a cold snap,
  // a hot stretch) reads at a glance instead of requiring seven separate
  // number comparisons.
  const weekLow = Math.min(...forecast.map((day) => day.tempLowC));
  const weekHigh = Math.max(...forecast.map((day) => day.tempHighC));
  const weekSpan = weekHigh - weekLow || 1;

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
      <ul className="flex gap-3 overflow-x-auto pb-1">
        {forecast.map((day) => {
          const date = toDate(day.date);
          const ConditionIcon = CONDITION_ICON[day.condition] ?? Cloud;
          const lowPct = ((day.tempLowC - weekLow) / weekSpan) * 100;
          const highPct = ((day.tempHighC - weekLow) / weekSpan) * 100;
          return (
            <li
              key={date.toISOString()}
              className="flex min-w-[108px] shrink-0 flex-col items-center gap-1 rounded-xl border p-3 text-center"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
            >
              <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
                {formatDayLabel(date, hydrated)}
              </span>
              <ConditionIcon aria-hidden="true" className="h-5 w-5 shrink-0" style={{ color: "var(--color-text-muted)" }} />
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                {CONDITION_LABEL[day.condition] ?? day.condition}
              </span>
              {/* Hero/muted pairing (display font for the high, small text
                  for the low) gives the number that matters most — today's
                  high — the visual weight, instead of one flat "lo – hi"
                  string every day reads identically. */}
              <span className="mt-1 text-2xl leading-none" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
                {Math.round(day.tempHighC)}°
              </span>
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                {Math.round(day.tempLowC)}°
              </span>
              <span className="sr-only">
                {Math.round(day.tempLowC)}° – {Math.round(day.tempHighC)}°C
              </span>
              <div className="relative mt-1 h-1 w-full rounded-full" style={{ background: "var(--color-border)" }}>
                <div
                  className="absolute inset-y-0 rounded-full"
                  style={{
                    left: `${lowPct}%`,
                    right: `${100 - highPct}%`,
                    background: day.isSnowDay ? "var(--color-sim-ink)" : "var(--color-clay)",
                  }}
                />
              </div>
              {day.precipitationMm > 0 && (
                <span className="mt-1 inline-flex items-center gap-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
                  <Droplets aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                  {Math.round(day.precipitationMm)}mm
                </span>
              )}
              {day.isSnowDay && (
                <span
                  className="mt-1 inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                  style={{ background: "var(--color-sim-bg)", color: "var(--color-sim-ink)" }}
                >
                  <Snowflake aria-hidden="true" className="h-3 w-3 shrink-0" />
                  Snow
                </span>
              )}
              {day.source === "PROCEDURAL" && (
                <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                  Estimated
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </Wrapper>
  );
}

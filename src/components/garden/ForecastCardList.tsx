"use client";

// One of ForecastStrip's two views: a card per day (the other being
// ForecastChartRows' curved-line chart). Each card is scannable on its own
// — condition, hi/lo, precipitation — where the chart view trades that for
// the week's overall shape at a glance.

import { Cloud, Droplets, Snowflake } from "lucide-react";
import type { WeatherDayView } from "@/domain/weather/weather-service";
import { CONDITION_ACCENT } from "./condition-accent";
import { CONDITION_ICON, CONDITION_LABEL } from "./WeatherBanner";

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatDayLabel(date: Date, useLocalZone: boolean): string {
  return date.toLocaleDateString(undefined, {
    weekday: "short",
    timeZone: useLocalZone ? undefined : "UTC",
  });
}

export interface ForecastCardListProps {
  forecast: WeatherDayView[];
  hydrated: boolean;
}

export function ForecastCardList({ forecast, hydrated }: ForecastCardListProps) {
  // A shared min/max across the whole week turns each day's hi/lo into a
  // positioned bar segment on one scale, so the week's shape (a cold snap,
  // a hot stretch) reads at a glance instead of requiring seven separate
  // number comparisons.
  const weekLow = Math.min(...forecast.map((day) => day.tempLowC));
  const weekHigh = Math.max(...forecast.map((day) => day.tempHighC));
  const weekSpan = weekHigh - weekLow || 1;

  return (
    // Flex + horizontal scroll below sm (cards need their min-width to stay
    // legible on a phone); an even 7-up grid from sm and up, so on anything
    // wider than a phone the whole week reads as one row with no clipped
    // edge hinting there's more to scroll.
    <ul className="flex gap-2 overflow-x-auto pb-1 sm:grid sm:grid-cols-7 sm:overflow-visible">
      {forecast.map((day) => {
        const date = toDate(day.date);
        const ConditionIcon = CONDITION_ICON[day.condition] ?? Cloud;
        const accent = day.isSnowDay ? "var(--color-sim-ink)" : (CONDITION_ACCENT[day.condition] ?? "var(--color-text-muted)");
        const lowPct = ((day.tempLowC - weekLow) / weekSpan) * 100;
        const highPct = ((day.tempHighC - weekLow) / weekSpan) * 100;
        return (
          <li
            key={date.toISOString()}
            className="flex min-w-[100px] shrink-0 flex-col items-center gap-1 rounded-2xl p-3 text-center transition-shadow duration-150 sm:min-w-0"
            style={{ background: "var(--color-surface)", boxShadow: "var(--shadow-card)" }}
          >
            <span className="text-[11px] font-bold uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>
              {formatDayLabel(date, hydrated)}
            </span>
            <ConditionIcon aria-hidden="true" className="mt-1 h-6 w-6 shrink-0" style={{ color: accent }} />
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {CONDITION_LABEL[day.condition] ?? day.condition}
            </span>
            {/* Hero/muted pairing (display font for the high, small text
                for the low) gives the number that matters most — today's
                high — the visual weight, instead of one flat "lo – hi"
                string every day reads identically. */}
            <span className="mt-1 text-3xl leading-none font-semibold" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
              {Math.round(day.tempHighC)}°
            </span>
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              {Math.round(day.tempLowC)}°
            </span>
            <span className="sr-only">
              {Math.round(day.tempLowC)}° – {Math.round(day.tempHighC)}°C
            </span>
            <div className="relative mt-2 h-1.5 w-full rounded-full" style={{ background: "var(--color-border)" }}>
              <div
                className="absolute inset-y-0 rounded-full"
                style={{
                  left: `${lowPct}%`,
                  right: `${100 - highPct}%`,
                  background: accent,
                }}
              />
            </div>
            <div className="mt-1 flex min-h-[1.25rem] flex-wrap items-center justify-center gap-1">
              {day.precipitationMm > 0 && (
                <span className="inline-flex items-center gap-1 text-xs" style={{ color: "var(--rainbarrel-fill)" }}>
                  <Droplets aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
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
            </div>
            {day.source === "PROCEDURAL" && (
              <span className="text-[10px]" style={{ color: "var(--color-text-muted)" }}>
                Estimated
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

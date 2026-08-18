"use client";

// The other of ForecastStrip's two views: stacked full-width rows (day
// labels, condition icons, a curved hi/lo temperature chart, then
// precipitation/badges) that all share one grid so every row lines up
// under the same day column — trades ForecastCardList's per-day
// scannability for the week's overall shape at a glance.

import { Cloud, Droplets, Snowflake } from "lucide-react";
import type { WeatherDayView } from "@/domain/weather/weather-service";
import { CONDITION_ACCENT } from "./condition-accent";
import { ForecastTempChart } from "./ForecastTempChart";
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

export interface ForecastChartRowsProps {
  forecast: WeatherDayView[];
  hydrated: boolean;
}

export function ForecastChartRows({ forecast, hydrated }: ForecastChartRowsProps) {
  const gridStyle = { gridTemplateColumns: `repeat(${forecast.length}, minmax(0, 1fr))` };

  return (
    <div>
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
    </div>
  );
}

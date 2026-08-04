"use client";

// The first Phase A surface: today's weather (src/domain/weather) and the
// sim clock's current date/phase (src/domain/growth/sim-clock-service.ts,
// src/domain/lighting) were previously computed every daily step and then
// thrown away as far as the UI was concerned — nothing read WeatherDay or
// the sun/phase calculation outside the growth engine itself. This renders
// GardenSnapshot.environment (grid-cell-service.ts) plainly, above the
// grid, so weather is visible without clicking anything.

import { Cloud, CloudLightning, CloudRain, CloudSun, Droplets, Satellite, Dices, Snowflake, Sun, Sunrise, Sunset, Thermometer, Wind } from "lucide-react";
import type { GardenEnvironment } from "./types";
import { useHydrated } from "./use-hydrated";

export const CONDITION_ICON: Record<string, typeof Sun> = {
  CLEAR: Sun,
  PARTLY_CLOUDY: CloudSun,
  CLOUDY: Cloud,
  RAIN: CloudRain,
  STORM: CloudLightning,
};

export const CONDITION_LABEL: Record<string, string> = {
  CLEAR: "Clear",
  PARTLY_CLOUDY: "Partly cloudy",
  CLOUDY: "Cloudy",
  RAIN: "Rain",
  STORM: "Storm",
};

export const PHASE_LABEL: Record<GardenEnvironment["phase"], string> = {
  DAWN: "Dawn",
  DAY: "Day",
  DUSK: "Dusk",
  NIGHT: "Night",
};

// `useLocalZone` false pins UTC for the render that has to byte-for-byte
// match the server (see useHydrated) — without it, the server (always UTC)
// and a visitor's browser (their own zone) render different text for the
// same Date, which is a hydration mismatch (React error #418). Once
// hydrated, true switches to the viewer's actual local zone so sunrise/
// sunset read as real wall-clock time instead of UTC.
function formatTime(iso: string, useLocalZone: boolean): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: useLocalZone ? undefined : "UTC",
  });
}

function formatDate(iso: string, useLocalZone: boolean): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: useLocalZone ? undefined : "UTC",
  });
}

export interface WeatherBannerProps {
  environment: GardenEnvironment;
  // When true, skips the card chrome (border/background/shadow) so this can
  // be nested inside another container — GardenTopTabs' "Today" tab panel —
  // that already provides it, instead of stacking card-in-card.
  bare?: boolean;
}

export function WeatherBanner({ environment, bare = false }: WeatherBannerProps) {
  const hydrated = useHydrated();
  const { weather } = environment;
  const ConditionIcon = weather ? (CONDITION_ICON[weather.condition] ?? Cloud) : Cloud;
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
      aria-labelledby="weather-heading"
    >
      <div>
        {!bare && (
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--color-clay-strong)" }}>
            Today in the garden
          </p>
        )}
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 id="weather-heading" className="text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
            {formatDate(environment.simTimeIso, hydrated)} · {PHASE_LABEL[environment.phase]}
          </h2>
          <p className="inline-flex items-center gap-3 text-xs" style={{ color: "var(--color-text-muted)" }}>
            <span className="inline-flex items-center gap-1">
              <Sunrise aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {formatTime(environment.sunriseIso, hydrated)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Sunset aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              {formatTime(environment.sunsetIso, hydrated)}
            </span>
          </p>
        </div>
      </div>

      {!weather ? (
        <p className="mt-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
          Weather hasn&apos;t been generated yet — advance the simulation to see today&apos;s conditions.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm" style={{ color: "var(--color-text)" }}>
          <span className="inline-flex items-center gap-1.5 text-base font-medium">
            <ConditionIcon aria-hidden="true" className="h-5 w-5 shrink-0" />
            {CONDITION_LABEL[weather.condition] ?? weather.condition}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Thermometer aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
            {Math.round(weather.tempLowC)}° – {Math.round(weather.tempHighC)}°C
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Droplets aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
            {Math.round(weather.precipitationMm)}mm · {Math.round(weather.humidityPct)}% humidity
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Cloud aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
            {Math.round(weather.cloudCoverPct)}% cloud
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Wind aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: "var(--color-text-muted)" }} />
            {Math.round(weather.windSpeedKph)} kph
          </span>
          {weather.isSnowDay && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold"
              style={{ background: "var(--color-sim-bg)", color: "var(--color-sim-ink)" }}
            >
              <Snowflake aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              Snow
            </span>
          )}
          <span
            className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
            style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
          >
            {weather.source === "REAL_API" ? (
              <Satellite aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <Dices aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            )}
            {weather.source === "REAL_API" ? "Live weather" : "Simulated weather"}
          </span>
        </div>
      )}
    </Wrapper>
  );
}

// Cached-read-through orchestration in front of the two WeatherProvider
// implementations (see the architecture doc's §3). An existing WeatherDay
// row for a date is authoritative and is never regenerated or refetched,
// regardless of which source is currently preferred — this is what keeps
// switching sources from silently rewriting history, and what makes the
// growth engine's catch-up step cheap to replay.

import type { PrismaClient, WeatherDay, WeatherSource } from "@prisma/client";
import type { WeatherLocation } from "./weather-provider";
import type { DailyWeather } from "./weather-provider";
import { ProceduralWeatherProvider } from "./procedural-weather-provider";
import { RealWeatherProvider } from "./real-weather-provider";
import { WeatherProviderUnavailableError } from "./errors";
import { isSnowDay } from "./snow";

export type WeatherSourcePreference = WeatherSource;

const procedural = new ProceduralWeatherProvider();
const real = new RealWeatherProvider();

function normalizeToUtcMidnight(date: Date): Date {
  const normalized = new Date(date);
  normalized.setUTCHours(0, 0, 0, 0);
  return normalized;
}

// REAL_API falls back to PROCEDURAL when the real source can't answer for
// this date (network failure, or the date is outside Open-Meteo's
// historical/forecast coverage) — never throws the whole growth step out
// over one missing weather day. This is the fallback chain from the
// architecture doc's §3: real historical -> real forecast -> procedural.
export async function getOrGenerateWeatherDay(
  prisma: PrismaClient,
  location: WeatherLocation,
  date: Date,
  preference: WeatherSourcePreference,
): Promise<WeatherDay> {
  const day = normalizeToUtcMidnight(date);
  const existing = await prisma.weatherDay.findUnique({ where: { date: day } });
  if (existing) {
    return existing;
  }

  let weather: DailyWeather;
  let source: WeatherSourcePreference;
  if (preference === "REAL_API") {
    try {
      weather = await real.getDay(location, day);
      source = "REAL_API";
    } catch (error: unknown) {
      if (!(error instanceof WeatherProviderUnavailableError)) {
        throw error;
      }
      weather = await procedural.getDay(location, day);
      source = "PROCEDURAL";
    }
  } else {
    weather = await procedural.getDay(location, day);
    source = "PROCEDURAL";
  }

  try {
    const created = await prisma.weatherDay.create({
      data: {
        date: day,
        tempHighC: weather.tempHighC,
        tempLowC: weather.tempLowC,
        precipitationMm: weather.precipitationMm,
        cloudCoverPct: weather.cloudCoverPct,
        humidityPct: weather.humidityPct,
        windSpeedKph: weather.windSpeedKph,
        condition: weather.condition,
        source,
      },
    });
    return created;
  } catch {
    // A concurrent request generated and cached this same date first (the
    // unique constraint on `date` rejects the second insert) — re-read
    // rather than surfacing a spurious failure; the loser of this race just
    // uses the winner's already-cached row.
    const winner = await prisma.weatherDay.findUnique({ where: { date: day } });
    if (winner) {
      return winner;
    }
    throw new WeatherProviderUnavailableError(
      `Failed to cache weather for ${day.toISOString()} and no concurrent winner was found.`,
    );
  }
}

export interface WeatherDayView {
  date: Date;
  condition: string;
  tempHighC: number;
  tempLowC: number;
  precipitationMm: number;
  cloudCoverPct: number;
  humidityPct: number;
  windSpeedKph: number;
  source: WeatherSourcePreference;
  isSnowDay: boolean;
}

// A pure read model for surfacing "today's weather" to the client (grid-cell-service.ts's
// GardenSnapshot.environment) — deliberately separate from getOrGenerateWeatherDay above,
// which writes. This function NEVER generates or refetches a WeatherDay: catchUpGrowth
// (invoked by every snapshot-refreshing action before the snapshot read) has already
// generated today's row via getOrGenerateWeatherDay, so a null here only ever means "before
// the simulation has been advanced even once" - the client is expected to show a friendly
// empty state, not trigger a write from a read path.
export async function getWeatherDayView(prisma: PrismaClient, date: Date): Promise<WeatherDayView | null> {
  const day = normalizeToUtcMidnight(date);
  const row = await prisma.weatherDay.findUnique({ where: { date: day } });
  if (!row) {
    return null;
  }
  return {
    date: row.date,
    condition: row.condition,
    tempHighC: row.tempHighC,
    tempLowC: row.tempLowC,
    precipitationMm: row.precipitationMm,
    cloudCoverPct: row.cloudCoverPct,
    humidityPct: row.humidityPct,
    windSpeedKph: row.windSpeedKph,
    source: row.source,
    isSnowDay: isSnowDay(row),
  };
}

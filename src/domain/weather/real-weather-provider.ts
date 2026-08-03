// Open-Meteo: free, keyless, lat/long-based — the real-weather source the
// architecture doc's §3 calls for, mirroring suncalc's own no-network/no-key
// precedent in src/domain/lighting/sun-times.ts (no secret to manage, so
// nothing for rules/typescript/security.md's secret-management checklist to
// flag). Two base URLs: `archive-api` for dates that have already happened,
// `api` (the standard forecast endpoint) for today and the following ~16
// days. A date past the forecast window has no real data available from
// either endpoint — the caller (weather-service.ts) is responsible for
// falling back to ProceduralWeatherProvider at that point, not this class.

import type { DailyWeather, WeatherLocation, WeatherProvider } from "./weather-provider";
import { WeatherProviderUnavailableError } from "./errors";

const ARCHIVE_BASE_URL = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_BASE_URL = "https://api.open-meteo.com/v1/forecast";
// Without this, a hung Open-Meteo response would stall the request
// indefinitely — catch-up-service.ts can call getDay up to MAX_CATCH_UP_DAYS
// (60) times in a row, so one slow response shouldn't block the rest.
const REQUEST_TIMEOUT_MS = 8_000;
// cloud_cover_mean/relative_humidity_2m_mean are requested but not
// documented as guaranteed on every Open-Meteo endpoint — parsed
// defensively below with a reasonable fallback rather than throwing, so a
// field-naming difference degrades quality instead of taking the whole
// real-weather source down. Reverify against current Open-Meteo docs before
// relying on this list in a context where humidity/cloud accuracy matters.
const DAILY_PARAMS = [
  "temperature_2m_max",
  "temperature_2m_min",
  "precipitation_sum",
  "wind_speed_10m_max",
  "cloud_cover_mean",
  "relative_humidity_2m_mean",
].join(",");

interface OpenMeteoDailyResponse {
  daily?: {
    time: string[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_sum?: number[];
    wind_speed_10m_max?: number[];
    cloud_cover_mean?: number[];
    relative_humidity_2m_mean?: number[];
  };
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function fallbackCloudCoverPct(precipitationMm: number): number {
  return precipitationMm > 0 ? 80 : 30;
}

function toDailyWeather(
  index: number,
  daily: NonNullable<OpenMeteoDailyResponse["daily"]>,
  date: Date,
): DailyWeather {
  const tempHighC = daily.temperature_2m_max?.[index];
  const tempLowC = daily.temperature_2m_min?.[index];
  if (tempHighC === undefined || tempLowC === undefined) {
    throw new WeatherProviderUnavailableError(
      `Open-Meteo response for ${isoDate(date)} is missing required temperature fields.`,
    );
  }
  const precipitationMm = daily.precipitation_sum?.[index] ?? 0;
  const cloudCoverPct = daily.cloud_cover_mean?.[index] ?? fallbackCloudCoverPct(precipitationMm);
  const humidityPct = daily.relative_humidity_2m_mean?.[index] ?? 60;
  const windSpeedKph = daily.wind_speed_10m_max?.[index] ?? 10;

  return {
    date,
    tempHighC,
    tempLowC,
    precipitationMm,
    cloudCoverPct,
    humidityPct,
    windSpeedKph,
    condition: precipitationMm > 10 ? "RAIN" : precipitationMm > 0 ? "PARTLY_CLOUDY" : "CLEAR",
  };
}

export class RealWeatherProvider implements WeatherProvider {
  async getDay(location: WeatherLocation, date: Date): Promise<DailyWeather> {
    // The archive endpoint only serves dates with a completed observation
    // record (safely "yesterday or earlier" everywhere); today forward goes
    // through the forecast endpoint instead.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const isPast = date.getTime() < today.getTime();
    const baseUrl = isPast ? ARCHIVE_BASE_URL : FORECAST_BASE_URL;
    const dateParam = isoDate(date);

    const url = new URL(baseUrl);
    url.searchParams.set("latitude", String(location.latitude));
    url.searchParams.set("longitude", String(location.longitude));
    url.searchParams.set("daily", DAILY_PARAMS);
    url.searchParams.set("timezone", "UTC");
    url.searchParams.set("start_date", dateParam);
    url.searchParams.set("end_date", dateParam);

    let response: Response;
    try {
      response = await fetch(url.toString(), { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error: unknown) {
      throw new WeatherProviderUnavailableError(
        `Could not reach Open-Meteo for ${dateParam}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (!response.ok) {
      throw new WeatherProviderUnavailableError(`Open-Meteo returned ${response.status} for ${dateParam}.`);
    }

    const body = (await response.json()) as OpenMeteoDailyResponse;
    if (!body.daily || body.daily.time.length === 0) {
      throw new WeatherProviderUnavailableError(`Open-Meteo returned no daily data for ${dateParam}.`);
    }
    return toDailyWeather(0, body.daily, date);
  }
}

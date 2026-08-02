// Pure translation from today's weather (WeatherDayView, see
// src/domain/weather/weather-service.ts) into particle parameters for
// WeatherParticles.tsx's drei <Sparkles> instance — kept out of the
// component itself so it's unit-testable without a WebGL context, same
// rationale as scene-lighting.ts.

export interface PrecipitationVisualInput {
  condition: string;
  precipitationMm: number;
  isSnowDay: boolean;
}

export interface PrecipitationVisual {
  count: number;
  speed: number;
  size: number;
  opacity: number;
  color: string;
  noise: number;
}

// A storm at max intensity still shouldn't be able to tank frame rate —
// this is a hard ceiling independent of precipitationMm's real range.
const MAX_PARTICLE_COUNT = 400;

const RAIN_COLOR = "#7f9db3";
const SNOW_COLOR = "#f4f8fc";

function clampCount(value: number): number {
  return Math.max(0, Math.min(MAX_PARTICLE_COUNT, Math.round(value)));
}

// Returns null for dry weather (no WeatherDay yet, or CLEAR/PARTLY_CLOUDY/
// CLOUDY with no precipitation) — WeatherParticles.tsx renders nothing in
// that case rather than a zero-count Sparkles instance. isSnowDay wins over
// `condition` (a sub-zero rainy day reads as snow, matching snow.ts's own
// isSnowDay predicate that already made this call for the growth engine).
export function precipitationVisual(input: PrecipitationVisualInput | null): PrecipitationVisual | null {
  if (!input) {
    return null;
  }
  if (input.isSnowDay) {
    return {
      count: clampCount(120 + input.precipitationMm * 6),
      speed: 0.15,
      size: 3,
      opacity: 0.85,
      color: SNOW_COLOR,
      noise: 0.6,
    };
  }
  if (input.condition === "STORM") {
    return {
      count: clampCount(220 + input.precipitationMm * 5),
      speed: 1.4,
      size: 1.2,
      opacity: 0.7,
      color: RAIN_COLOR,
      noise: 0.15,
    };
  }
  if (input.condition === "RAIN" && input.precipitationMm > 0) {
    return {
      count: clampCount(90 + input.precipitationMm * 4),
      speed: 0.9,
      size: 1,
      opacity: 0.6,
      color: RAIN_COLOR,
      noise: 0.2,
    };
  }
  return null;
}

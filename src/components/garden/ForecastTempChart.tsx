"use client";

// The dual curved-line temperature chart for ForecastStrip — high and low
// across the week on one shared scale, each point labeled, mirroring how
// stock weather apps (e.g. iOS Weather's 10-day view) draw this rather than
// the plain min/max bar this replaced. The connecting line is drawn as a
// percentage-scaled SVG path (a little horizontal stretch is imperceptible
// on a smooth curve); the dots and temperature labels are separate
// absolutely-positioned HTML elements at the same x/y so they stay
// perfectly round and undistorted regardless of the container's width.

import { buildSmoothPath, type ChartPoint } from "./chart-smooth-path";

const VIEW_HEIGHT = 108;
const PAD_TOP = 20;
const PAD_BOTTOM = 20;
const COLUMN_WIDTH = 100;

export interface ForecastTempChartDay {
  tempHighC: number;
  tempLowC: number;
  isSnowDay: boolean;
}

export interface ForecastTempChartProps {
  days: ForecastTempChartDay[];
  highColor?: string;
  lowColor?: string;
  snowColor?: string;
}

function scaleY(value: number, min: number, max: number): number {
  const span = max - min || 1;
  const usableHeight = VIEW_HEIGHT - PAD_TOP - PAD_BOTTOM;
  return PAD_TOP + ((max - value) / span) * usableHeight;
}

export function ForecastTempChart({
  days,
  highColor = "var(--color-clay-strong)",
  lowColor = "var(--rainbarrel-fill)",
  snowColor = "var(--color-sim-ink)",
}: ForecastTempChartProps) {
  if (days.length === 0) {
    return null;
  }

  const columnCount = days.length;
  const viewWidth = columnCount * COLUMN_WIDTH;
  const allTemps = days.flatMap((day) => [day.tempHighC, day.tempLowC]);
  const min = Math.min(...allTemps);
  const max = Math.max(...allTemps);

  const highPoints: ChartPoint[] = days.map((day, i) => ({
    x: (i + 0.5) * COLUMN_WIDTH,
    y: scaleY(day.tempHighC, min, max),
  }));
  const lowPoints: ChartPoint[] = days.map((day, i) => ({
    x: (i + 0.5) * COLUMN_WIDTH,
    y: scaleY(day.tempLowC, min, max),
  }));

  return (
    <div className="relative" style={{ height: VIEW_HEIGHT }} aria-hidden="true">
      <svg className="absolute inset-0 h-full w-full" viewBox={`0 0 ${viewWidth} ${VIEW_HEIGHT}`} preserveAspectRatio="none">
        <path d={buildSmoothPath(highPoints)} fill="none" stroke={highColor} strokeWidth={2} strokeLinecap="round" />
        <path d={buildSmoothPath(lowPoints)} fill="none" stroke={lowColor} strokeWidth={2} strokeLinecap="round" />
      </svg>
      {days.map((day, i) => {
        const leftPct = ((i + 0.5) / columnCount) * 100;
        const highY = scaleY(day.tempHighC, min, max);
        const lowY = scaleY(day.tempLowC, min, max);
        const highDotColor = day.isSnowDay ? snowColor : highColor;
        const lowDotColor = day.isSnowDay ? snowColor : lowColor;
        return (
          <div key={i}>
            <span
              className="absolute text-[11px] leading-none font-semibold"
              style={{ left: `${leftPct}%`, top: highY - 6, color: highDotColor, transform: "translate(-50%, -100%)" }}
            >
              {Math.round(day.tempHighC)}°
            </span>
            <span
              className="absolute h-1.5 w-1.5 rounded-full"
              style={{ left: `${leftPct}%`, top: highY, background: highDotColor, transform: "translate(-50%, -50%)" }}
            />
            <span
              className="absolute h-1.5 w-1.5 rounded-full"
              style={{ left: `${leftPct}%`, top: lowY, background: lowDotColor, transform: "translate(-50%, -50%)" }}
            />
            <span
              className="absolute text-[11px] leading-none"
              style={{ left: `${leftPct}%`, top: lowY + 6, color: lowDotColor, transform: "translate(-50%, 0%)" }}
            >
              {Math.round(day.tempLowC)}°
            </span>
          </div>
        );
      })}
    </div>
  );
}

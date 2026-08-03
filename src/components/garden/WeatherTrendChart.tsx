"use client";

// Weather-trends chart for the Trends tab — temperature range as two lines
// plus precipitation as bars on a secondary axis, one ComposedChart so both
// share the same date x-axis instead of two separately-scrolling charts.

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WeatherDayView } from "@/domain/weather/weather-service";

export interface WeatherTrendChartProps {
  data: WeatherDayView[];
  bare?: boolean;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}

function formatDayLabel(value: Date | string): string {
  return toDate(value).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });
}

export function WeatherTrendChart({ data, bare = false }: WeatherTrendChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        No weather history recorded in this range yet.
      </p>
    );
  }

  const rows = data.map((day) => ({
    dateIso: toDate(day.date).toISOString(),
    tempHighC: day.tempHighC,
    tempLowC: day.tempLowC,
    precipitationMm: day.precipitationMm,
  }));

  const Wrapper = bare ? "div" : "section";

  return (
    <Wrapper
      className={bare ? undefined : "rounded-xl border p-4 sm:p-5"}
      style={
        bare
          ? undefined
          : { borderColor: "var(--color-border)", background: "var(--color-surface-raised)", boxShadow: "var(--shadow-card)" }
      }
      aria-labelledby="weather-trend-heading"
    >
      <h3 id="weather-trend-heading" className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        Weather trends
      </h3>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="dateIso"
              tickFormatter={formatDayLabel}
              stroke="var(--color-text-muted)"
              tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
            />
            <YAxis
              yAxisId="temp"
              stroke="var(--color-text-muted)"
              tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
              label={{ value: "°C", angle: -90, position: "insideLeft", fill: "var(--color-text-muted)" }}
            />
            <YAxis
              yAxisId="precip"
              orientation="right"
              stroke="var(--color-text-muted)"
              tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
              label={{ value: "mm", angle: 90, position: "insideRight", fill: "var(--color-text-muted)" }}
            />
            <Tooltip
              labelFormatter={(value) => formatDayLabel(String(value))}
              contentStyle={{
                background: "var(--color-surface-raised)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-text-muted)" }} />
            <Bar yAxisId="precip" dataKey="precipitationMm" name="Precipitation (mm)" fill="var(--color-sim-ink)" barSize={8} />
            <Line
              yAxisId="temp"
              type="monotone"
              dataKey="tempHighC"
              name="High (°C)"
              stroke="var(--color-clay-strong)"
              strokeWidth={2}
              dot={false}
            />
            <Line
              yAxisId="temp"
              type="monotone"
              dataKey="tempLowC"
              name="Low (°C)"
              stroke="var(--color-accent)"
              strokeWidth={2}
              dot={false}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </Wrapper>
  );
}

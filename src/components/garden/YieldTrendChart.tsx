"use client";

// Yield-over-time chart for the Trends tab. Renders one line per distinct
// harvest unit present in the data (most gardens surface 1-2 units at once,
// especially once TrendsPanel's plant filter narrows the range) rather than
// assuming a single unit, since HarvestRecord.unit is freeform per-plant text.

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { YieldTrendPoint } from "@/domain/journal/yield-trend-service";

export interface YieldTrendChartProps {
  data: YieldTrendPoint[];
  bare?: boolean;
}

// Rotates through existing design-token hues rather than introducing new
// chart-only colors — keeps a multi-unit chart visually consistent with the
// rest of the app's palette (see globals.css).
const LINE_COLORS = [
  "var(--color-accent)",
  "var(--color-clay-strong)",
  "var(--color-sim-ink)",
  "var(--color-cta-bg)",
];

function formatDayLabel(dateIso: string): string {
  return new Date(`${dateIso}T00:00:00.000Z`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function YieldTrendChart({ data, bare = false }: YieldTrendChartProps) {
  if (data.length === 0) {
    return (
      <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
        No harvests recorded in this range yet.
      </p>
    );
  }

  const units: string[] = [];
  for (const point of data) {
    for (const total of point.totalsByUnit) {
      if (!units.includes(total.unit)) units.push(total.unit);
    }
  }

  const rows = data.map((point) => {
    const row: Record<string, string | number> = { dateIso: point.dateIso };
    for (const total of point.totalsByUnit) {
      row[total.unit] = total.amount;
    }
    return row;
  });

  const Wrapper = bare ? "div" : "section";

  return (
    <Wrapper
      className={bare ? undefined : "rounded-xl border p-4 sm:p-5"}
      style={
        bare
          ? undefined
          : { borderColor: "var(--color-border)", background: "var(--color-surface-raised)", boxShadow: "var(--shadow-card)" }
      }
      aria-labelledby="yield-trend-heading"
    >
      <h3 id="yield-trend-heading" className="mb-2 text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        Yield over time
      </h3>
      <div style={{ width: "100%", height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 12, bottom: 4, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
            <XAxis
              dataKey="dateIso"
              tickFormatter={formatDayLabel}
              stroke="var(--color-text-muted)"
              tick={{ fill: "var(--color-text-muted)", fontSize: 12 }}
            />
            <YAxis stroke="var(--color-text-muted)" tick={{ fill: "var(--color-text-muted)", fontSize: 12 }} />
            <Tooltip
              labelFormatter={(value) => formatDayLabel(String(value))}
              contentStyle={{
                background: "var(--color-surface-raised)",
                borderColor: "var(--color-border)",
                color: "var(--color-text)",
              }}
            />
            <Legend wrapperStyle={{ fontSize: 12, color: "var(--color-text-muted)" }} />
            {units.map((unit, index) => (
              <Line
                key={unit}
                type="monotone"
                dataKey={unit}
                name={unit}
                stroke={LINE_COLORS[index % LINE_COLORS.length]}
                strokeWidth={2}
                dot={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </Wrapper>
  );
}

"use client";

import type { ReactNode } from "react";
import type { LegendSection, LegendVisibilityContext } from "./legend-sections";

// The shared renderer both GridLegend (GardenGrid.tsx) and Viewer3DLegend.tsx
// call into — replaces their independently-duplicated row JSX. Always a
// <details>/<summary> disclosure (previously only the 3D legend had this;
// promoting the 2D legend to match gives it the same free keyboard-operable
// toggle) wrapped in a role="region" landmark so screen-reader users can
// jump to it directly, not just stumble into inline decorative content.
//
// Legend entries are intentionally non-interactive static text, not a
// custom roving-tabindex widget — a legend key isn't an actionable control
// (correct per WAI-ARIA), so "keyboard-navigable" here means the disclosure
// toggle is reachable/operable and the whole block is a discoverable
// landmark, not that each row is individually tabbable.
//
// Every entry's swatch is aria-hidden with the adjacent visible text as the
// accessible name — never ship a color-only row.
export function LegendPanel({
  sections,
  ctx,
  title = "Legend",
  extra,
}: {
  sections: LegendSection[];
  ctx: LegendVisibilityContext;
  title?: string;
  extra?: ReactNode;
}) {
  const visibleSections = sections.filter((section) => section.show(ctx));
  return (
    <details
      className="rounded-lg border p-3 text-xs"
      style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
      role="region"
      aria-label={title}
    >
      <summary className="cursor-pointer select-none font-semibold" style={{ color: "var(--color-text)" }}>
        {title}
      </summary>
      <div className="mt-2 flex flex-col gap-2">
        {visibleSections.map((section) => (
          <ul key={section.id} className="flex flex-wrap gap-x-4 gap-y-1">
            {section.entries.map((entry) => (
              <li key={entry.key} className="flex items-center gap-1.5">
                {(entry.cssClass || entry.hex) && (
                  <span
                    aria-hidden="true"
                    className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${entry.cssClass ?? ""}`}
                    style={entry.hex && !entry.cssClass ? { background: entry.hex } : undefined}
                  />
                )}
                {entry.Icon && <entry.Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                {entry.label}
              </li>
            ))}
          </ul>
        ))}
        {extra}
      </div>
    </details>
  );
}

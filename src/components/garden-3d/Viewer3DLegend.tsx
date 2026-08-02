"use client";

// The 3D viewer's legend — now a thin call site around the shared
// LegendPanel (src/components/garden/LegendPanel.tsx), which also backs
// GardenGrid.tsx's 2D legend. Previously this file independently
// re-implemented the same status/health/equipment/pest rows with a
// different color source (hex via STATUS_TINT/HEALTH_BAND_HEX) than the 2D
// legend's CSS-var classes — unnecessary, since this is plain sibling DOM
// under the canvas (per this file's own long-standing accessibility
// precedent: real, focusable, screen-reader-visible content, never a drei
// <Html> label), not a canvas element, so it never actually needed hex for
// its own swatches. The hex maps stay exactly as they were for the real 3D
// meshes in GardenScene3D.tsx/Plant.tsx; this component simply stops being
// one of their consumers.

import { MIN_DISPLAY_POPULATION, MIN_DISPLAY_SEVERITY } from "@/components/garden/pest-display";
import { LEGEND_SECTIONS } from "@/components/garden/legend-sections";
import { LegendPanel } from "@/components/garden/LegendPanel";
import type { SnapshotBed } from "@/components/garden/types";

export function Viewer3DLegend({ beds }: { beds: SnapshotBed[] }) {
  const showEquipment = beds.some((bed) => bed.equipment.length > 0);
  const showInfection = beds.some((bed) =>
    bed.cells.some((cell) =>
      cell.plantings.some((planting) => planting.infections.some((infection) => infection.severity >= MIN_DISPLAY_SEVERITY)),
    ),
  );
  const showPests = beds.some((bed) => bed.pests.some((pest) => pest.population >= MIN_DISPLAY_POPULATION));
  const showPredators = beds.some((bed) => bed.predators.some((predator) => predator.population >= MIN_DISPLAY_POPULATION));

  return (
    <LegendPanel
      sections={LEGEND_SECTIONS}
      ctx={{ showEquipment, showInfection, showPests, showPredators }}
      title="What am I looking at?"
      extra={
        <>
          <p>Ring at the base of a plant: health/stress state. Dark speckled tint on a plant: active disease infection.</p>
          <p>Lower hovering swarm above a bed: pest pressure. Higher hovering swarm: predators active.</p>
          <p>Lighting follows the real sun position and today&rsquo;s cloud cover; falling particles are rain or snow.</p>
        </>
      }
    />
  );
}

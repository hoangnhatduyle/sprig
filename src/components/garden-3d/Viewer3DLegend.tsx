"use client";

// The 3D viewer's "What am I looking at?" hint. Previously reused
// GardenGrid.tsx's full status/health color-key legend here too (via the
// shared LegendPanel, src/components/garden/LegendPanel.tsx) — but that key
// describes the 2D grid's own cell colors and is already right there in its
// own "Legend" panel a few hundred pixels away on the same page. Repeating
// it here just for an empty garden with nothing planted read as unexplained
// clutter rather than a 3D-specific hint, so this now renders only the
// prose that's actually specific to interpreting the 3D scene.
import { LegendPanel } from "@/components/garden/LegendPanel";

export function Viewer3DLegend() {
  return (
    <LegendPanel
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

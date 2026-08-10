"use client";

// Canvas wrapper for the GLB-based interactive twin: orbit camera sized to
// the model's real scale (src/domain/garden-3d/orbit-camera-bounds-3d.ts),
// WebGL feature-detection with a text fallback, and a sibling-DOM readout
// (not a drei <Html> label inside the canvas) for the hovered/selected
// cell's info - the same accessibility precedent Viewer3D.tsx documents:
// real, focusable, screen-reader-visible DOM, not content trapped behind
// WebGL.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import {
  GARDEN_3D_ORBIT_BOUNDS,
  garden3dCameraDistance,
} from "@/domain/garden-3d/orbit-camera-bounds-3d";
import { computeSceneLighting } from "@/domain/garden-3d/scene-lighting";
import { precipitationVisual } from "@/domain/garden-3d/weather-visuals";
import { orbitCameraPosition } from "@/domain/viewer/orbit-camera-bounds";
import { CONDITION_LABEL, PHASE_LABEL } from "@/components/garden/WeatherBanner";
import { EQUIPMENT_KIND_LABEL } from "@/components/garden/equipment-display";
import { plantName } from "@/components/garden/plant-lookup";
import { STATUS_WORD } from "@/components/garden/status-display";
import { HEALTH_BAND_LABEL, STRESS_DIAL_LABEL, healthBand } from "@/components/garden/stress-display";
import { DISEASE_LABEL, bedPestPhrase, bedPredatorPhrase, diseaseSeverityBand } from "@/components/garden/pest-display";
import type { GardenEnvironment, PlantOption, SelectedCell, SnapshotBed, SnapshotRainBarrel } from "@/components/garden/types";
import { useWebGlSupport } from "@/components/viewer/use-webgl-support";
import {
  buildCellRenderStates,
  buildEquipmentRenderStates,
  buildPestSwarmRenderStates,
  buildPredatorSwarmRenderStates,
  buildRainBarrelRenderStates,
  resolveCellTarget,
} from "./garden-3d-adapter";
import { GardenScene3D } from "./GardenScene3D";
import { Viewer3DLegend } from "./Viewer3DLegend";

// Subscribes to the live media query via useSyncExternalStore rather than
// setState-in-an-effect (react-hooks/set-state-in-effect) — the same
// pattern use-webgl-support.ts already established for a browser-capability
// external store, just live-subscribed here instead of a once-only probe
// since reduced-motion preference can change at runtime.
function subscribeReducedMotion(callback: () => void): () => void {
  if (typeof window.matchMedia !== "function") {
    return () => {};
  }
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getReducedMotionSnapshot(): boolean {
  // jsdom (the component test suite) doesn't implement matchMedia — same
  // feature-detection precedent GardenView.tsx already uses for
  // scrollIntoView, rather than assuming a real browser.
  if (typeof window.matchMedia !== "function") {
    return false;
  }
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribeReducedMotion, getReducedMotionSnapshot, () => false);
}

// Same useSyncExternalStore pattern as usePrefersReducedMotion above, just
// subscribed to document.visibilitychange instead of a media query — a
// backgrounded/unfocused tab must not keep paying for continuous
// frameloop="always" rendering (rain/pest animation) just because weather or
// a pest swarm happens to be active. See the frameloop computation below.
function subscribePageVisible(callback: () => void): () => void {
  if (typeof document === "undefined") {
    return () => {};
  }
  document.addEventListener("visibilitychange", callback);
  return () => document.removeEventListener("visibilitychange", callback);
}

function getPageVisibleSnapshot(): boolean {
  if (typeof document === "undefined") {
    return true;
  }
  return document.visibilityState === "visible";
}

function usePageVisible(): boolean {
  return useSyncExternalStore(subscribePageVisible, getPageVisibleSnapshot, () => true);
}

const INITIAL_CAMERA = orbitCameraPosition(
  { distance: garden3dCameraDistance(4 / 3), azimuthAngle: Math.PI / 4, polarAngle: 1.0 },
  GARDEN_3D_ORBIT_BOUNDS,
);

function ResponsiveCamera({ controlsRef }: { controlsRef: RefObject<OrbitControlsImpl | null> }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    const distance = garden3dCameraDistance(size.width / size.height);
    const position = orbitCameraPosition(
      { distance, azimuthAngle: Math.PI / 4, polarAngle: 1.0 },
      GARDEN_3D_ORBIT_BOUNDS,
    );

    camera.position.set(...position);
    camera.lookAt(
      GARDEN_3D_ORBIT_BOUNDS.target.x,
      GARDEN_3D_ORBIT_BOUNDS.target.y,
      GARDEN_3D_ORBIT_BOUNDS.target.z,
    );
    camera.updateProjectionMatrix();
    controlsRef.current?.target.set(
      GARDEN_3D_ORBIT_BOUNDS.target.x,
      GARDEN_3D_ORBIT_BOUNDS.target.y,
      GARDEN_3D_ORBIT_BOUNDS.target.z,
    );
    controlsRef.current?.update();
    // With frameloop="demand" these are imperative mutations on the camera
    // object itself, which the store's auto-invalidate-on-state-change
    // subscription can't see (the object reference never changes) - request
    // a frame explicitly so a resize actually repaints.
    invalidate();
  }, [camera, controlsRef, invalidate, size.height, size.width]);

  return null;
}

export interface GardenViewer3DProps {
  beds: SnapshotBed[];
  environment: GardenEnvironment;
  rainBarrels: SnapshotRainBarrel[];
  plants: PlantOption[];
  selectedCell: SelectedCell | null;
  disabled?: boolean;
  onCellClick: (target: SelectedCell) => void;
}

export function GardenViewer3D({ beds, environment, rainBarrels, plants, selectedCell, disabled, onCellClick }: GardenViewer3DProps) {
  const [hoveredNodeName, setHoveredNodeName] = useState<string | null>(null);
  const controlsRef = useRef<OrbitControlsImpl>(null);
  const canRender3D = useWebGlSupport();
  const reducedMotion = usePrefersReducedMotion();
  const pageVisible = usePageVisible();

  const cellStates = useMemo(() => buildCellRenderStates(beds, selectedCell), [beds, selectedCell]);
  const equipmentBySide = useMemo(() => buildEquipmentRenderStates(beds), [beds]);
  const pestSwarmBySide = useMemo(() => buildPestSwarmRenderStates(beds), [beds]);
  const predatorSwarmBySide = useMemo(() => buildPredatorSwarmRenderStates(beds), [beds]);
  const rainBarrelStates = useMemo(() => buildRainBarrelRenderStates(rainBarrels), [rainBarrels]);
  const hasActiveSwarm = [...pestSwarmBySide.values(), ...predatorSwarmBySide.values()].some((visual) => visual !== null);
  const lighting = useMemo(
    () =>
      computeSceneLighting({
        sunAltitudeRad: environment.sunAltitudeRad,
        sunAzimuthRad: environment.sunAzimuthRad,
        phase: environment.phase,
        cloudCoverPct: environment.weather?.cloudCoverPct ?? 0,
        isSnowDay: environment.weather?.isSnowDay ?? false,
      }),
    [environment],
  );
  const weatherVisual = useMemo(
    () =>
      precipitationVisual(
        environment.weather
          ? {
              condition: environment.weather.condition,
              precipitationMm: environment.weather.precipitationMm,
              isSnowDay: environment.weather.isSnowDay,
            }
          : null,
      ),
    [environment.weather],
  );
  // <Sparkles> animates via useFrame, which never runs under
  // frameloop="demand" — without switching to "always" while rain/snow (or
  // a pest/predator swarm, PestSwarm.tsx's own <Sparkles>) is active,
  // particles would render as a single frozen point cloud instead of
  // falling/hovering. Reverts to "demand" (this canvas's normal, cheaper
  // mode) the moment there's nothing to animate, motion is reduced, OR the
  // tab isn't visible — a backgrounded tab with active rain/pests has no
  // reason to keep rendering every frame at full, uncapped rate (the
  // reported cause of sustained high CPU/GPU usage while the page sits open
  // in the background).
  const frameloop = (weatherVisual || hasActiveSwarm) && !reducedMotion && pageVisible ? "always" : "demand";

  function handleCellClick(nodeName: string): void {
    if (disabled) {
      return;
    }
    const target = resolveCellTarget(nodeName, beds);
    if (target) {
      onCellClick(target);
    }
  }

  // Hover takes priority when present; otherwise the readout mirrors
  // whatever's currently selected (including a selection made in the 2D
  // grid above), so this panel never goes blank just because the pointer
  // isn't over the canvas.
  const readoutTarget = hoveredNodeName ? resolveCellTarget(hoveredNodeName, beds) : selectedCell;
  const readoutGrowth = readoutTarget?.plantings?.[0]?.growth ?? null;
  const readoutBand = readoutGrowth ? healthBand(readoutGrowth) : null;
  const readoutBed = readoutTarget ? beds.find((bed) => bed.id === readoutTarget.bedId) : null;

  return (
    <section aria-labelledby="garden-3d-heading" className="flex flex-col gap-3">
      <div>
        <p
          className="mb-1 text-xs font-semibold uppercase tracking-[0.2em]"
          style={{ color: "var(--color-clay-strong)" }}
        >
          Three-dimensional
        </p>
        <h2
          id="garden-3d-heading"
          className="text-2xl"
          style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}
        >
          3D garden
        </h2>
      </div>
      <div
        data-testid="garden-3d-viewport"
        className="relative aspect-[4/3] w-full overflow-hidden rounded-xl border shadow-sm xl:aspect-[3/2] 2xl:aspect-[5/4]"
        style={{
          background: "var(--color-scene-bg)",
          borderColor: "var(--color-border)",
        }}
      >
        {canRender3D ? (
          <Canvas
            aria-hidden="true"
            style={{ touchAction: "none" }}
            camera={{ position: INITIAL_CAMERA, fov: 45 }}
            // Capped at 1.5 rather than the drei/r3f default of 2 — halves
            // peak pixel count on high-DPI laptop screens (the reported
            // fan-spin hardware) with minimal visible quality loss on a
            // scene this size.
            dpr={[1, 1.5]}
            frameloop={frameloop}
          >
            <ResponsiveCamera controlsRef={controlsRef} />
            <GardenScene3D
              cellStates={cellStates}
              lighting={lighting}
              weatherVisual={weatherVisual}
              reducedMotion={reducedMotion}
              equipmentBySide={equipmentBySide}
              pestSwarmBySide={pestSwarmBySide}
              predatorSwarmBySide={predatorSwarmBySide}
              rainBarrelStates={rainBarrelStates}
              onCellClick={handleCellClick}
              onCellHover={setHoveredNodeName}
            />
            <OrbitControls
              ref={controlsRef}
              makeDefault
              // Unlike the small procedural viewer's fixed-target camera,
              // this scene renders the artist's full model (fence, trellis,
              // trees) well beyond the beds themselves, so panning is
              // wanted, not fenced off. three-stdlib's OrbitControls maps
              // Shift/Ctrl/Cmd + left-drag to pan automatically once
              // enablePan is true (see its onMouseDown) - the same gesture
              // Blender uses.
              enablePan
              enableDamping
              dampingFactor={0.08}
              target={[GARDEN_3D_ORBIT_BOUNDS.target.x, GARDEN_3D_ORBIT_BOUNDS.target.y, GARDEN_3D_ORBIT_BOUNDS.target.z]}
              minDistance={GARDEN_3D_ORBIT_BOUNDS.minDistance}
              maxDistance={GARDEN_3D_ORBIT_BOUNDS.maxDistance}
              minPolarAngle={GARDEN_3D_ORBIT_BOUNDS.minPolarAngle}
              maxPolarAngle={GARDEN_3D_ORBIT_BOUNDS.maxPolarAngle}
            />
          </Canvas>
        ) : (
          <p
            className="flex h-full items-center justify-center px-6 text-center text-sm"
            style={{ color: "var(--color-text-muted)" }}
          >
            The 3D scene needs WebGL, which this browser isn&rsquo;t providing. Use the 2D grid above to
            manage the garden.
          </p>
        )}
      </div>
      <div aria-live="polite" className="flex flex-col gap-1 text-sm" style={{ color: "var(--color-text-muted)" }}>
        <p>
          {PHASE_LABEL[environment.phase]}
          {environment.weather &&
            ` · ${CONDITION_LABEL[environment.weather.condition] ?? environment.weather.condition} · ${Math.round(environment.weather.tempLowC)}°–${Math.round(environment.weather.tempHighC)}°C · ${Math.round(environment.weather.windSpeedKph)} kph wind · ${environment.weather.source === "REAL_API" ? "live weather" : "simulated weather"}`}
        </p>
        {readoutTarget ? (
          <p>
            <span style={{ color: "var(--color-text)" }}>
              {readoutTarget.bedName}, column {readoutTarget.column}, row {readoutTarget.row}
            </span>
            {" — "}
            {STATUS_WORD[readoutTarget.status]}
            {readoutTarget.plantIds.length > 0 &&
              `: ${readoutTarget.plantIds.map((id) => plantName(plants, id)).join(", ")}`}
            {readoutGrowth && readoutBand && readoutBand !== "healthy" && `, ${HEALTH_BAND_LABEL[readoutBand].toLowerCase()}`}
            {readoutGrowth?.dominantStressDial &&
              `: ${STRESS_DIAL_LABEL[readoutGrowth.dominantStressDial] ?? readoutGrowth.dominantStressDial}`}
            {readoutTarget.environment && `, soil moisture ${Math.round(readoutTarget.environment.soilMoistureFraction * 100)}%`}
            {readoutBed && readoutBed.equipment.length > 0 &&
              `, equipped with ${readoutBed.equipment.map((override) => EQUIPMENT_KIND_LABEL[override.kind]).join(", ")}`}
            {(() => {
              const activeInfections = (readoutTarget.plantings ?? []).flatMap((planting) => planting.infections);
              if (activeInfections.length === 0) return null;
              return `, ${activeInfections
                .map((infection) => `${diseaseSeverityBand(infection.severity)} ${DISEASE_LABEL[infection.diseaseKey] ?? infection.diseaseKey}`)
                .join(", ")}`;
            })()}
            {readoutBed && bedPestPhrase(readoutBed.pests) && `, ${bedPestPhrase(readoutBed.pests)}`}
            {readoutBed && bedPredatorPhrase(readoutBed.predators) && `, ${bedPredatorPhrase(readoutBed.predators)}`}
          </p>
        ) : (
          <p>Click a cell in the 3D view to select it — the picker above will open.</p>
        )}
      </div>
      <Viewer3DLegend />
    </section>
  );
}

import { readFileSync } from "node:fs";
import path from "node:path";
import type { ReactElement, ReactNode } from "react";
import { describe, expect, it } from "vitest";
import {
  Plant,
  RootCrop,
  RosetteLeafy,
  Seedling,
  UprightBush,
  Vining,
  type GrowthHabit,
  type PlantGrowthProps,
} from "@/components/viewer/Plant";

// Traces to: /home/hoang/projects/Sprig/.claude/tests/SPEC-VIEWER-004.tests.yaml
// Each `it` below is named after its harness case id so validate_coverage
// results map 1:1 back to the generated test plan.
//
// Plant.tsx and its shape sub-components are hook-free pure functions that
// return React-Three-Fiber (R3F) JSX (<mesh>, <group>, ...). This project has
// no @react-three/test-renderer / react-test-renderer dependency, and R3F
// intrinsics can't be meaningfully rendered through RTL/jsdom. Rather than
// add a new test dependency, these cases call the functions directly (no
// renderer) and walk the plain React-element object tree they return.

// A JSX element like `<UprightBush .../>` is just an inert `{ type, props }`
// object until a renderer invokes `type(props)` — JSX never calls component
// functions itself. Since every component in Plant.tsx is hook-free, this
// walker acts as a minimal shallow renderer: it recurses into a function
// component's own output (in addition to intrinsic elements' `children`) so
// the flattened list includes the actual <mesh>/<meshLambertMaterial>/...
// elements those components render, not just their opaque call sites.
function flatten(node: ReactNode): ReactElement[] {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(flatten);
  if (typeof node !== "object" || !("type" in node)) return [];
  const el = node as ReactElement<{ children?: ReactNode }>;
  if (typeof el.type === "function") {
    const rendered = (el.type as (props: unknown) => ReactNode)(el.props);
    return [el, ...flatten(rendered)];
  }
  return [el, ...flatten(el.props?.children)];
}

function meshesIn(tree: ReactElement[]): ReactElement[] {
  return tree.filter((el) => el.type === "mesh");
}

function meshWithGeometry(meshes: ReactElement[], geometryType: string): ReactElement {
  const mesh = meshes.find((el) =>
    flatten((el.props as { children?: ReactNode }).children).some((child) => child.type === geometryType),
  );
  if (!mesh) {
    throw new Error(`expected a mesh containing a <${geometryType}> among ${meshes.length} mesh(es)`);
  }
  return mesh;
}

function materialColorOf(mesh: ReactElement): string {
  const material = flatten((mesh.props as { children?: ReactNode }).children).find(
    (el) => el.type === "meshLambertMaterial",
  );
  if (!material) {
    throw new Error("expected a meshLambertMaterial child on the given mesh");
  }
  return (material.props as { color: string }).color;
}

const HABITS: GrowthHabit[] = ["UPRIGHT_BUSH", "VINING", "ROSETTE_LEAFY", "ROOT_CROP"];

function baseGrowth(overrides: Partial<PlantGrowthProps> = {}): PlantGrowthProps {
  return {
    phenologyStage: "VEGETATIVE",
    growthHabit: "UPRIGHT_BUSH",
    leafFraction: 0.4,
    stemFraction: 0.3,
    rootFraction: 0.3,
    flowerFraction: 0,
    fruitFraction: 0,
    waterContentIndex: 1,
    cumulativeStress: 0,
    primaryColor: "#5e9c4f",
    micronutrientIndexFraction: 1,
    dominantStressDial: null,
    infection: null,
    ...overrides,
  };
}

function renderPlant(growth: PlantGrowthProps, seed = 1): ReactElement[] {
  return flatten(Plant({ status: "GROWING", growth, x: 0, z: 0, seed }));
}

function crownColorFor(growth: PlantGrowthProps): string {
  const crownMesh = meshWithGeometry(meshesIn(renderPlant(growth)), "icosahedronGeometry");
  return materialColorOf(crownMesh);
}

describe("SPEC-VIEWER-004", () => {
  it("T-SPEC-VIEWER-004-AC-AC_1: GERMINATING plantings render the Seedling shape for every growth habit, never the full-crown shape", () => {
    for (const habit of HABITS) {
      const tree = renderPlant(baseGrowth({ growthHabit: habit, phenologyStage: "GERMINATING" }));

      expect(tree.some((el) => el.type === Seedling)).toBe(true);
      expect(tree.some((el) => el.type === UprightBush)).toBe(false);
      expect(tree.some((el) => el.type === Vining)).toBe(false);
      expect(tree.some((el) => el.type === RosetteLeafy)).toBe(false);
      expect(tree.some((el) => el.type === RootCrop)).toBe(false);
    }
  });

  it("T-SPEC-VIEWER-004-AC-AC_2: a healthy SENESCENT planting reads as senescent, not wilted/chlorotic/diseased (also covers NC-SPRIG-VIEWER3-STAGE-DISTINCT-FROM-STRESS)", () => {
    const healthyInputs = {
      waterContentIndex: 1,
      cumulativeStress: 0,
      micronutrientIndexFraction: 1,
      infection: null,
    } as const;

    const senescentColor = crownColorFor(baseGrowth({ ...healthyInputs, phenologyStage: "SENESCENT" }));
    const vegetativeColor = crownColorFor(baseGrowth({ ...healthyInputs, phenologyStage: "VEGETATIVE" }));

    // Senescence actually tinted the color away from the raw species color...
    expect(senescentColor).not.toBe("#5e9c4f");
    // ...and produced a color distinct from the same healthy inputs without
    // the SENESCENT stage, proving the branch is live rather than a no-op
    // that happens to fall through the existing (zero-amount, at these
    // healthy inputs) wilt/chlorosis/disease chain unchanged.
    expect(senescentColor).not.toBe(vegetativeColor);
  });

  it("T-SPEC-VIEWER-004-AC-AC_3: MATURE and FRUITING crowns read fuller than VEGETATIVE at equal biomassFraction, without changing height", () => {
    const vegetativeTree = renderPlant(baseGrowth({ phenologyStage: "VEGETATIVE", growthHabit: "UPRIGHT_BUSH" }), 7);
    const vegetativeCrown = meshWithGeometry(meshesIn(vegetativeTree), "icosahedronGeometry");
    const vegetativeGeometry = flatten((vegetativeCrown.props as { children?: ReactNode }).children).find(
      (el) => el.type === "icosahedronGeometry",
    )!;
    const vegetativeRadius = (vegetativeGeometry.props as { args: number[] }).args[0];
    const vegetativePosition = (vegetativeCrown.props as { position: number[] }).position;

    for (const stage of ["MATURE", "FRUITING"] as const) {
      const fullerTree = renderPlant(baseGrowth({ phenologyStage: stage, growthHabit: "UPRIGHT_BUSH" }), 7);
      const fullerCrown = meshWithGeometry(meshesIn(fullerTree), "icosahedronGeometry");
      const fullerGeometry = flatten((fullerCrown.props as { children?: ReactNode }).children).find(
        (el) => el.type === "icosahedronGeometry",
      )!;
      const fullerRadius = (fullerGeometry.props as { args: number[] }).args[0];
      const fullerPosition = (fullerCrown.props as { position: number[] }).position;

      expect(fullerRadius).toBeGreaterThan(vegetativeRadius);
      // "fuller, not just taller" — the crown's Y position (driven by
      // `height`, which is habit+biomassFraction only) must be unchanged.
      expect(fullerPosition).toEqual(vegetativePosition);
    }
  });

  // T-SPEC-VIEWER-004-AC-AC_4: no new unit test — this case is satisfied by
  // re-running the existing e2e/simulation-surfacing.spec.ts (and related
  // cell-selection specs) unchanged after the Plant.tsx edits land. Run via
  // `npm run test:e2e`, not vitest.

  it("T-SPEC-VIEWER-004-NC-NC_SPRIG_VIEWER3_NO_BIOLOGY_CHANGE: Plant.tsx does not import growth-engine internals", () => {
    // A static regression guard, not a RED->GREEN feature test: nothing
    // behavioral changes when this passes. It's already vacuously true
    // before this spec's implementation and must stay true after.
    const source = readFileSync(path.join(process.cwd(), "src/components/viewer/Plant.tsx"), "utf-8");
    expect(source).not.toMatch(/growth-engine-service|daily-step-orchestrator|catch-up-service/);
  });

  it("T-SPEC-VIEWER-004-NC-NC_SPRIG_VIEWER3_NO_RAYCAST_REGRESSION: every mesh rendered for a GERMINATING planting opts out of raycasting", () => {
    const tree = renderPlant(baseGrowth({ phenologyStage: "GERMINATING" }), 3);
    const meshes = meshesIn(tree);

    expect(meshes.length).toBeGreaterThan(0);
    for (const mesh of meshes) {
      const raycast = (mesh.props as { raycast?: unknown }).raycast;
      expect(typeof raycast).toBe("function");
      expect((raycast as () => null)()).toBeNull();
    }
  });
});

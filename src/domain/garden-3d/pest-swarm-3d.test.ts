import { describe, expect, it } from "vitest";
import { pestSwarmVisual, predatorSwarmVisual } from "./pest-swarm-3d";

describe("pestSwarmVisual", () => {
  it("returns null for an empty bed", () => {
    expect(pestSwarmVisual([])).toBeNull();
  });

  it("returns null when every population is below the display threshold", () => {
    expect(pestSwarmVisual([{ pestKey: "aphid", population: 0.05 }])).toBeNull();
  });

  it("returns a visual sized off the bed's total population", () => {
    const low = pestSwarmVisual([{ pestKey: "aphid", population: 1 }]);
    const high = pestSwarmVisual([{ pestKey: "aphid", population: 5 }]);
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(high!.count).toBeGreaterThan(low!.count);
  });

  it("sums populations across multiple pests in the same bed", () => {
    const single = pestSwarmVisual([{ pestKey: "aphid", population: 1 }]);
    const combined = pestSwarmVisual([
      { pestKey: "aphid", population: 1 },
      { pestKey: "caterpillar", population: 1 },
    ]);
    expect(combined!.count).toBeGreaterThan(single!.count);
  });

  it("caps particle count regardless of how large the population is", () => {
    const extreme = pestSwarmVisual([{ pestKey: "aphid", population: 10_000 }]);
    expect(extreme).not.toBeNull();
    expect(extreme!.count).toBeLessThanOrEqual(60);
  });
});

describe("predatorSwarmVisual", () => {
  it("returns null for an empty bed", () => {
    expect(predatorSwarmVisual([])).toBeNull();
  });

  it("returns null when every population is below the display threshold", () => {
    expect(predatorSwarmVisual([{ predatorKey: "ladybug", population: 0.05 }])).toBeNull();
  });

  it("returns a visual sized off the bed's total population", () => {
    const low = predatorSwarmVisual([{ predatorKey: "ladybug", population: 1 }]);
    const high = predatorSwarmVisual([{ predatorKey: "ladybug", population: 5 }]);
    expect(low).not.toBeNull();
    expect(high).not.toBeNull();
    expect(high!.count).toBeGreaterThan(low!.count);
  });

  it("caps particle count regardless of how large the population is", () => {
    const extreme = predatorSwarmVisual([{ predatorKey: "ladybug", population: 10_000 }]);
    expect(extreme).not.toBeNull();
    expect(extreme!.count).toBeLessThanOrEqual(60);
  });

  it("uses a distinct color from the pest swarm so the two read as different signals", () => {
    const pest = pestSwarmVisual([{ pestKey: "aphid", population: 5 }]);
    const predator = predatorSwarmVisual([{ predatorKey: "ladybug", population: 5 }]);
    expect(predator!.color).not.toBe(pest!.color);
  });
});

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LegendPanel } from "./LegendPanel";
import { LEGEND_SECTIONS } from "./legend-sections";

afterEach(() => {
  cleanup();
});

const BASE_CTX = { showEquipment: false, showInfection: false, showPests: false, showPredators: false };

describe("LegendPanel", () => {
  it("is a keyboard-operable, landmark-labeled disclosure", () => {
    render(<LegendPanel sections={LEGEND_SECTIONS} ctx={BASE_CTX} />);
    const region = screen.getByRole("region", { name: "Legend" });
    expect(region.tagName).toBe("DETAILS");
    expect(region).not.toHaveAttribute("open");
  });

  it("always shows the status and health sections", () => {
    render(<LegendPanel sections={LEGEND_SECTIONS} ctx={BASE_CTX} />);
    expect(screen.getByText("Planted")).toBeInTheDocument();
    expect(screen.getByText("Watch plant")).toBeInTheDocument();
  });

  it("hides conditional sections when their context flag is false", () => {
    render(<LegendPanel sections={LEGEND_SECTIONS} ctx={BASE_CTX} />);
    expect(screen.queryByText("Active infection")).not.toBeInTheDocument();
    expect(screen.queryByText("Shade cloth")).not.toBeInTheDocument();
  });

  it("shows conditional sections when their context flag is true", () => {
    render(
      <LegendPanel
        sections={LEGEND_SECTIONS}
        ctx={{ showEquipment: true, showInfection: true, showPests: true, showPredators: true }}
      />,
    );
    expect(screen.getByText("Active infection")).toBeInTheDocument();
    expect(screen.getByText("Shade cloth")).toBeInTheDocument();
  });

  it("expands via the native details/summary toggle", () => {
    render(<LegendPanel sections={LEGEND_SECTIONS} ctx={BASE_CTX} />);
    const summary = screen.getByText("Legend");
    fireEvent.click(summary);
    const region = screen.getByRole("region", { name: "Legend" });
    expect(region).toHaveAttribute("open");
  });
});

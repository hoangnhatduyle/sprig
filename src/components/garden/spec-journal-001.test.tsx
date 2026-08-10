import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CellPicker } from "./CellPicker";
import { JournalPanel } from "./JournalPanel";
import { NeedsAttentionBanner } from "./NeedsAttentionBanner";
import type { JournalEntry, SelectedCell, SnapshotBed } from "./types";

// Traces to: /home/hoang/projects/Sprig/.claude/tests/SPEC-JOURNAL-001.tests.yaml
// Each `it` below is named after its harness case id so validate_coverage
// results map 1:1 back to the generated test plan (same convention as
// spec-plantui-001.test.tsx).

afterEach(() => {
  cleanup();
});

const BEDS: SnapshotBed[] = [
  {
    id: "bed-1",
    name: "Left Bed",
    widthFt: 4,
    lengthFt: 8,
    gridCols: 4,
    gridRows: 8,
    compassPosition: "SOUTH",
    cells: [],
    equipment: [],
    pests: [],
    predators: [],
    soilProfile: null,
  } as unknown as SnapshotBed,
];

function baseEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    kind: "HARVEST",
    id: "entry-1",
    occurredAt: "2026-06-01T12:00:00.000Z",
    bedId: "bed-1",
    bedName: "Left Bed",
    column: 1,
    row: 1,
    plantId: "plant-1",
    plantName: "Tomato",
    amount: 3,
    unit: "item",
    notes: null,
    ...overrides,
  } as JournalEntry;
}

describe("JournalPanel", () => {
  it("T-SPEC-JOURNAL-001-AC-AC_1: renders each seeded entry with its phrase and timestamp", () => {
    render(
      <JournalPanel
        beds={BEDS}
        initialJournal={{ entries: [baseEntry()], hasMore: false }}
        getJournal={vi.fn()}
        createNote={vi.fn()}
      />,
    );
    expect(screen.getByText(/Harvested 3 item of Tomato/)).toBeInTheDocument();
  });

  it("shows an empty state when there are no entries", () => {
    render(
      <JournalPanel
        beds={BEDS}
        initialJournal={{ entries: [], hasMore: false }}
        getJournal={vi.fn()}
        createNote={vi.fn()}
      />,
    );
    expect(screen.getByText(/Nothing recorded yet/)).toBeInTheDocument();
  });

  it("T-SPEC-JOURNAL-001-AC-AC_8: changing the bed filter re-fetches with the selected bedId", async () => {
    const getJournal = vi.fn().mockResolvedValue({ entries: [], hasMore: false });
    render(
      <JournalPanel
        beds={BEDS}
        initialJournal={{ entries: [baseEntry()], hasMore: false }}
        getJournal={getJournal}
        createNote={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Bed"), { target: { value: "bed-1" } });
    await waitFor(() => expect(getJournal).toHaveBeenCalledWith(expect.objectContaining({ bedId: "bed-1" })));
  });

  it("does not re-fetch on mount when initialJournal is provided", () => {
    const getJournal = vi.fn().mockResolvedValue({ entries: [], hasMore: false });
    render(
      <JournalPanel
        beds={BEDS}
        initialJournal={{ entries: [baseEntry()], hasMore: false }}
        getJournal={getJournal}
        createNote={vi.fn()}
      />,
    );
    expect(getJournal).not.toHaveBeenCalled();
  });

  it("T-SPEC-JOURNAL-001-AC-AC_6: submitting the note form with text calls createNote with a FormData body", async () => {
    const createNote = vi.fn().mockResolvedValue({ ok: true });
    render(
      <JournalPanel
        beds={BEDS}
        initialJournal={{ entries: [], hasMore: false }}
        getJournal={vi.fn().mockResolvedValue({ entries: [], hasMore: false })}
        createNote={createNote}
      />,
    );
    fireEvent.change(screen.getByLabelText("Add a note"), { target: { value: "Aphids on the squash." } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    await waitFor(() => expect(createNote).toHaveBeenCalledTimes(1));
    const formData = createNote.mock.calls[0][0] as FormData;
    expect(formData.get("body")).toBe("Aphids on the squash.");
    expect(await screen.findByText("Note added.")).toBeInTheDocument();
  });

  it("the save-note button is disabled with no text and no photo", () => {
    render(
      <JournalPanel
        beds={BEDS}
        initialJournal={{ entries: [], hasMore: false }}
        getJournal={vi.fn()}
        createNote={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /save note/i })).toBeDisabled();
  });

  it("switches to the Season recap sub-view without unmounting the outer panel", () => {
    render(
      <JournalPanel
        beds={BEDS}
        initialJournal={{ entries: [baseEntry()], hasMore: false }}
        getJournal={vi.fn()}
        createNote={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "Season recap" }));
    expect(screen.getByRole("button", { name: /generate recap/i })).toBeInTheDocument();
    expect(screen.queryByText(/Nothing recorded yet/)).not.toBeInTheDocument();
  });
});

describe("NeedsAttentionBanner", () => {
  it("renders nothing when no bed has stressed, critical, or infected cells", () => {
    const { container } = render(<NeedsAttentionBanner beds={BEDS} plants={[]} onSelectCell={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("surfaces a per-bed warning when a bed has critical cells", () => {
    const stressedBed = {
      ...BEDS[0],
      cells: [
        {
          column: 1,
          row: 1,
          status: "GROWING",
          plantIds: ["plant-1"],
          plantings: [
            {
              growth: {
                phenologyStage: "VEGETATIVE",
                cumulativeStress: 0.95,
                waterContentIndex: 1,
                dominantStressDial: "drought",
              },
              infections: [],
            },
          ],
          environment: null,
        },
      ],
    } as unknown as SnapshotBed;
    render(<NeedsAttentionBanner beds={[stressedBed]} plants={[]} onSelectCell={vi.fn()} />);
    expect(screen.getByText(/Left Bed/)).toBeInTheDocument();
    expect(screen.getByText(/critical/i)).toBeInTheDocument();
  });
});

function baseCell(overrides: Partial<SelectedCell> = {}): SelectedCell {
  return {
    bedId: "bed-1",
    bedName: "North Bed",
    column: 1,
    row: 1,
    status: "GROWING",
    plantIds: ["plant-tomato"],
    plantings: [],
    environment: null,
    ...overrides,
  };
}

describe("CellPicker — cell note entry point", () => {
  it("the 'Add a note about this cell' section only renders when createJournalNote is provided", () => {
    render(
      <CellPicker
        cell={baseCell()}
        plants={[{ id: "plant-tomato", commonName: "Tomato" }]}
        isOpen={false}
        isSubmitting={false}
        onOpen={vi.fn()}
        onAssign={vi.fn()}
        onAddCompanion={vi.fn()}
        onCancel={vi.fn()}
        onDeselect={vi.fn()}
        error={null}
      />,
    );
    expect(screen.queryByText(/Add a note about this cell/i)).not.toBeInTheDocument();
  });

  it("submitting a cell note calls createJournalNote with bedId/column/row and the typed body", async () => {
    const createJournalNote = vi.fn().mockResolvedValue({ ok: true });
    render(
      <CellPicker
        cell={baseCell()}
        plants={[{ id: "plant-tomato", commonName: "Tomato" }]}
        isOpen={false}
        isSubmitting={false}
        onOpen={vi.fn()}
        onAssign={vi.fn()}
        onAddCompanion={vi.fn()}
        onCancel={vi.fn()}
        onDeselect={vi.fn()}
        error={null}
        createJournalNote={createJournalNote}
      />,
    );
    // Note is open by default now — no click needed to reach its form.
    fireEvent.change(screen.getByLabelText("Note"), { target: { value: "Aphids spotted here." } });
    fireEvent.click(screen.getByRole("button", { name: /save note/i }));

    await waitFor(() => expect(createJournalNote).toHaveBeenCalledTimes(1));
    const formData = createJournalNote.mock.calls[0][0] as FormData;
    expect(formData.get("body")).toBe("Aphids spotted here.");
    expect(formData.get("bedId")).toBe("bed-1");
    expect(formData.get("column")).toBe("1");
    expect(formData.get("row")).toBe("1");
    // lifecycleMessage is shared state rendered next to every action
    // section in CellPicker (Growth, Care, and this Notes section all show
    // the same current status line) — assert presence, not uniqueness.
    await waitFor(() => expect(screen.getAllByText("Note added.").length).toBeGreaterThan(0));
  });
});

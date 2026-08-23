"use client";

// Merges what used to be three separate bordered cards — WeatherBanner,
// InventoryPanel, ConditionsPanel — into one tabbed surface, per user
// request. SimClockControl lives inside the "Today" tab, above the weather
// banner: it's what actually generates the WeatherDay row that banner reads,
// so keeping the two together means the control and its effect are never
// more than a glance apart.

import dynamic from "next/dynamic";
import { useState } from "react";
import { InventoryPanel } from "@/components/inventory/InventoryPanel";
import type { GardenJournal } from "@/domain/journal/journal-service";
import type { InventorySnapshot } from "@/domain/plant-catalog/inventory-service";
import { AppPanel } from "./AppPanel";
import { ConditionsPanel } from "./ConditionsPanel";
import { ForecastStrip } from "./ForecastStrip";
import { JournalPanel } from "./JournalPanel";
import { PestPanel } from "./PestPanel";
import { SimClockControl } from "./SimClockControl";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import { WeatherBanner } from "./WeatherBanner";
import type { GardenEnvironment, SnapshotBed } from "./types";

// TrendsPanel pulls in recharts (~500kb uncompressed) purely for two charts
// that only render once a user opens this tab and clicks "Generate" — every
// other tab here mounts eagerly (see the `hidden`-not-unmounted comment
// below), so without code-splitting, recharts rode along in the same
// critical first-load bundle as the always-needed 2D grid. Same rationale
// and pattern as GardenView.tsx's dynamic GardenViewer3D import.
const TrendsPanel = dynamic(() => import("./TrendsPanel").then((mod) => mod.TrendsPanel), {
  loading: () => <div className="h-40 w-full animate-pulse rounded-xl border" style={{ borderColor: "var(--color-border)" }} />,
});

const TABS = [
  { id: "today", label: "Today" },
  { id: "inventory", label: "Household inventory" },
  { id: "simulation", label: "What-if Planner" },
  { id: "journal", label: "Journal" },
  { id: "trends", label: "Trends" },
  { id: "app", label: "App" },
] as const;

type TabId = (typeof TABS)[number]["id"];

export interface GardenTopTabsProps {
  environment: GardenEnvironment;
  inventory: InventorySnapshot;
  beds: SnapshotBed[];
  initialJournal?: GardenJournal;
  disabled?: boolean;
  onChanged: () => Promise<void>;
}

export function GardenTopTabs({ environment, inventory, beds, initialJournal, disabled = false, onChanged }: GardenTopTabsProps) {
  const [tab, setTab] = useState<TabId>("today");
  // Shared across ConditionsPanel and PestPanel — both used to carry their
  // own identical "Beds" fieldset, which meant picking a bed for a what-if
  // preview and picking one to spray were two disconnected selections that
  // looked like the same control. One selection for the whole tab.
  const [whatIfBedIds, setWhatIfBedIds] = useState<string[]>([]);

  function toggleWhatIfBed(bedId: string): void {
    setWhatIfBedIds((prev) => (prev.includes(bedId) ? prev.filter((id) => id !== bedId) : [...prev, bedId]));
  }

  return (
    <section
      className="rounded-xl border p-4 sm:p-5"
      style={{
        borderColor: "var(--color-border)",
        background: "var(--color-surface-raised)",
        boxShadow: "var(--shadow-card)",
      }}
    >
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Garden overview">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={`${id}-tab`}
            aria-selected={tab === id}
            aria-controls={`${id}-panel`}
            onClick={() => setTab(id)}
            className={`${MIN_TOUCH_TARGET} rounded-md border px-4 text-sm font-semibold ${FOCUS_RING}`}
            style={{
              borderColor: tab === id ? "var(--color-accent)" : "var(--color-border)",
              background: tab === id ? "var(--color-surface)" : "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* `hidden` (not unmounting) keeps each tab's local state — inventory
          search text, selected beds, an in-progress what-if preview — alive
          across tab switches, the same way the seeds/yield sub-tabs inside
          InventoryPanel already behave. */}
      <div id="today-panel" role="tabpanel" aria-labelledby="today-tab" hidden={tab !== "today"} className="flex flex-col gap-4">
        <SimClockControl
          clockRate={environment.clockRate}
          simTimeIso={environment.simTimeIso}
          onAdvance={onChanged}
          disabled={disabled}
        />
        <WeatherBanner environment={environment} bare />
        <ForecastStrip forecast={environment.forecast} bare />
      </div>
      <div id="inventory-panel" role="tabpanel" aria-labelledby="inventory-tab" hidden={tab !== "inventory"}>
        <InventoryPanel inventory={inventory} disabled={disabled} onChanged={onChanged} bare />
      </div>
      <div id="simulation-panel" role="tabpanel" aria-labelledby="simulation-tab" hidden={tab !== "simulation"} className="flex flex-col gap-6">
        <fieldset className="rounded-xl border p-4 sm:p-5" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)", boxShadow: "var(--shadow-card)" }}>
          <legend className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>
            Beds
          </legend>
          <p className="mb-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
            Applies to both conditions and pests/predators below.
          </p>
          <div className="flex flex-wrap gap-2">
            {beds.map((bed) => (
              <label
                key={bed.id}
                className={`flex items-center gap-2 rounded-md border px-3 ${MIN_TOUCH_TARGET} text-sm ${FOCUS_RING}`}
                style={{
                  borderColor: whatIfBedIds.includes(bed.id) ? "var(--color-accent)" : "var(--color-border)",
                  background: whatIfBedIds.includes(bed.id) ? "var(--color-surface)" : "transparent",
                }}
              >
                <input type="checkbox" checked={whatIfBedIds.includes(bed.id)} onChange={() => toggleWhatIfBed(bed.id)} disabled={disabled} />
                {bed.name}
              </label>
            ))}
          </div>
        </fieldset>
        <ConditionsPanel beds={beds} selectedBedIds={whatIfBedIds} disabled={disabled} onChanged={onChanged} bare />
        <PestPanel beds={beds} selectedBedIds={whatIfBedIds} disabled={disabled} onChanged={onChanged} bare />
      </div>
      <div id="journal-panel" role="tabpanel" aria-labelledby="journal-tab" hidden={tab !== "journal"}>
        <JournalPanel beds={beds} initialJournal={initialJournal} disabled={disabled} onChanged={onChanged} bare />
      </div>
      <div id="trends-panel" role="tabpanel" aria-labelledby="trends-tab" hidden={tab !== "trends"}>
        <TrendsPanel beds={beds} inventory={inventory} disabled={disabled} bare />
      </div>
      <div id="app-panel" role="tabpanel" aria-labelledby="app-tab" hidden={tab !== "app"}>
        <AppPanel />
      </div>
    </section>
  );
}

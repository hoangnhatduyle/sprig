// Shared Journal display data — same one-file-per-domain-concern convention
// as equipment-display.ts/pest-display.ts/stress-display.ts: one source of
// labels/icons/phrases so a journal entry reads the same word everywhere it
// might appear (the feed, a future notification, a season recap line).

import {
  Bug,
  Camera,
  Droplets,
  Hammer,
  Leaf,
  Layers,
  Recycle,
  Scissors,
  Sparkles,
  Sprout,
  type LucideIcon,
} from "lucide-react";
import type { CareActionType } from "@prisma/client";
import { DISEASE_LABEL } from "./pest-display";
import { EQUIPMENT_KIND_LABEL } from "./equipment-display";
import { STATUS_WORD } from "./status-display";
import type { JournalEntry, JournalEntryKind } from "./types";

export const JOURNAL_KIND_LABEL: Record<JournalEntryKind, string> = {
  LIFECYCLE: "Planting",
  HARVEST: "Harvest",
  CARE_ACTION: "Care",
  EQUIPMENT: "Equipment",
  RENOVATION: "Bed renovation",
  DISEASE: "Disease",
  NOTE: "Note",
};

export const JOURNAL_KIND_ICON: Record<JournalEntryKind, LucideIcon> = {
  LIFECYCLE: Sprout,
  HARVEST: Leaf,
  CARE_ACTION: Droplets,
  EQUIPMENT: Layers,
  RENOVATION: Hammer,
  DISEASE: Bug,
  NOTE: Camera,
};

export const CARE_ACTION_TYPE_LABEL: Record<CareActionType, string> = {
  MULCH: "Mulched",
  COMPOST: "Composted",
  FERTILIZER: "Fertilized",
  WEEDING: "Weeded",
  FUNGICIDE: "Fungicide applied",
  PESTICIDE: "Pesticide applied",
  PREDATOR_RELEASE: "Predators released",
};

export const CARE_ACTION_TYPE_ICON: Record<CareActionType, LucideIcon> = {
  MULCH: Layers,
  COMPOST: Recycle,
  FERTILIZER: Droplets,
  WEEDING: Scissors,
  FUNGICIDE: Sparkles,
  PESTICIDE: Sparkles,
  PREDATOR_RELEASE: Bug,
};

function cellLabel(entry: { bedName: string; column: number | null; row: number | null }): string {
  return entry.column != null && entry.row != null
    ? `${entry.bedName}, column ${entry.column}, row ${entry.row}`
    : entry.bedName;
}

// One-line, plain-text summary of any entry — the WCAG 1.4.1 text carrier
// so the feed never relies on icon/color alone to convey what happened
// (same discipline as pest-display.ts's bedPestPhrase/cellInfectionPhrase).
export function journalEntryPhrase(entry: JournalEntry): string {
  switch (entry.kind) {
    case "LIFECYCLE": {
      const plant = entry.plantName ?? "A plant";
      const verb = STATUS_WORD[entry.eventType];
      return `${plant} ${verb.toLowerCase()} in ${cellLabel(entry)}.`;
    }
    case "HARVEST":
      return `Harvested ${entry.amount} ${entry.unit} of ${entry.plantName} from ${cellLabel(entry)}.`;
    case "CARE_ACTION":
      return `${CARE_ACTION_TYPE_LABEL[entry.actionType]} in ${cellLabel(entry)}.`;
    case "EQUIPMENT": {
      const label = EQUIPMENT_KIND_LABEL[entry.equipmentKind];
      return entry.phase === "installed"
        ? `${label} installed on ${entry.bedName}.`
        : `${label} removed from ${entry.bedName}.`;
    }
    case "RENOVATION":
      return `${entry.bedName} resized from ${entry.previousCols}×${entry.previousRows} to ${entry.newCols}×${entry.newRows} — ${entry.note}`;
    case "DISEASE": {
      const label = DISEASE_LABEL[entry.diseaseKey] ?? entry.diseaseKey;
      return entry.phase === "started"
        ? `${label} detected on ${entry.plantName} in ${cellLabel(entry)}.`
        : `${label} resolved on ${entry.plantName} in ${cellLabel(entry)}.`;
    }
    case "NOTE":
      return entry.body ?? (entry.photoUrl ? "Photo added." : "Note added.");
    default:
      return "";
  }
}

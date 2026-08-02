import { Biohazard, Bug, Shield, ShieldCheck, Snail, type LucideIcon } from "lucide-react";
import { DISEASE_DEFINITIONS } from "@/domain/disease/disease-catalog";
import { PEST_DEFINITIONS } from "@/domain/pests/pest-catalog";
import { PREDATOR_DEFINITIONS } from "@/domain/pests/predator-catalog";

// Shared display data for disease/pest/predator state (SnapshotInfection,
// SnapshotPestPopulation, SnapshotPredatorPopulation — see
// grid-cell-service.ts) — same convention as equipment-display.ts/
// stress-display.ts: labels/icons derived from the domain catalogs' own
// key/displayName rather than hand-duplicated, so a newly-added catalog
// entry can't silently ship unlabeled the way STRESS_DIAL_LABEL previously
// shipped without a `pestDisease` entry.

export const DISEASE_LABEL: Record<string, string> = Object.fromEntries(
  DISEASE_DEFINITIONS.map((disease) => [disease.key, disease.displayName]),
);

export const PEST_LABEL: Record<string, string> = Object.fromEntries(
  PEST_DEFINITIONS.map((pest) => [pest.key, pest.displayName]),
);

export const PREDATOR_LABEL: Record<string, string> = Object.fromEntries(
  PREDATOR_DEFINITIONS.map((predator) => [predator.key, predator.displayName]),
);

// All three catalog diseases are currently FUNGAL — one shared icon per
// disease key rather than per DiseaseKind, since there's nothing to
// differentiate yet; a future BACTERIAL/VIRAL entry just needs a new line
// here, same "config, not code" precedent the catalogs themselves follow.
export const DISEASE_ICON: Record<string, LucideIcon> = Object.fromEntries(
  DISEASE_DEFINITIONS.map((disease) => [disease.key, Biohazard]),
);

export const PEST_ICON: Record<string, LucideIcon> = {
  aphid: Bug,
  caterpillar: Bug,
  slug: Snail,
};

export const PREDATOR_ICON: Record<string, LucideIcon> = {
  ladybug: Shield,
  "general-beneficials": ShieldCheck,
};

// Cosmetic display thresholds: PestPopulation/PredatorPopulation rows
// persist near-zero once created (upsert-based in pest-service.ts), and a
// disease infection lingers just above 0 severity right before resolving
// (disease-action-service.ts's RESOLVE_BELOW_SEVERITY = 0.03) — filtering
// those out is this display layer's job, not grid-cell-service.ts's, which
// stays the unfiltered ground truth (same division healthBand() already
// has vs. the raw cumulativeStress field).
export const MIN_DISPLAY_SEVERITY = 0.05;
export const MIN_DISPLAY_POPULATION = 0.15;

export type DiseaseSeverityBand = "mild" | "moderate" | "severe";

const SEVERE_THRESHOLD = 0.7;
const MODERATE_THRESHOLD = 0.4;

export function diseaseSeverityBand(severity: number): DiseaseSeverityBand {
  if (severity >= SEVERE_THRESHOLD) return "severe";
  if (severity >= MODERATE_THRESHOLD) return "moderate";
  return "mild";
}

export const DISEASE_SEVERITY_LABEL: Record<DiseaseSeverityBand, string> = {
  mild: "Mild",
  moderate: "Moderate",
  severe: "Severe",
};

// Same escalation ramp as stress-display.ts's HEALTH_BAND_CSS (CSS custom
// properties from globals.css), reused rather than a parallel ramp so a
// "moderate" infection and a "watch" health band read as the same urgency.
export const DISEASE_SEVERITY_CSS: Record<DiseaseSeverityBand, string> = {
  mild: "bg-[var(--health-watch)]",
  moderate: "bg-[var(--health-stressed)]",
  severe: "bg-[var(--health-critical)]",
};

export type PestPressureBand = "low" | "moderate" | "high";

// Independent, population-scale bands — NOT pest-service.ts's
// pestPressureDialValue (that function normalizes by host biomass and a
// growthHabit for the biology engine's stress dial; this is a display-only
// banding of the raw bed-level population number, a different scale for a
// different purpose). Do not conflate the two.
const HIGH_POPULATION = 3;
const MODERATE_POPULATION = 1;

export function pestPressureBand(population: number): PestPressureBand {
  if (population >= HIGH_POPULATION) return "high";
  if (population >= MODERATE_POPULATION) return "moderate";
  return "low";
}

export const PEST_PRESSURE_LABEL: Record<PestPressureBand, string> = {
  low: "Low",
  moderate: "Moderate",
  high: "High",
};

// Text carriers for aria-labels — WCAG 1.4.1: color/icon must never be the
// only signal, same rationale as stress-display.ts's cellHealthPhrase().
export function cellInfectionPhrase(
  infections: readonly { diseaseKey: string; severity: number }[],
): string | null {
  const active = infections.filter((infection) => infection.severity >= MIN_DISPLAY_SEVERITY);
  if (active.length === 0) {
    return null;
  }
  return active
    .map((infection) => {
      const label = DISEASE_LABEL[infection.diseaseKey] ?? infection.diseaseKey;
      const band = DISEASE_SEVERITY_LABEL[diseaseSeverityBand(infection.severity)].toLowerCase();
      return `${band} ${label}`;
    })
    .join(", ");
}

export function bedPestPhrase(pests: readonly { pestKey: string; population: number }[]): string | null {
  const active = pests.filter((pest) => pest.population >= MIN_DISPLAY_POPULATION);
  if (active.length === 0) {
    return null;
  }
  return active
    .map((pest) => {
      const label = PEST_LABEL[pest.pestKey] ?? pest.pestKey;
      const band = PEST_PRESSURE_LABEL[pestPressureBand(pest.population)].toLowerCase();
      return `${band} ${label} pressure`;
    })
    .join(", ");
}

// Predator presence is good news, not a "pressure" to escalate — no
// severity band, just which beneficials are active on this bed (the text
// carrier for the 3D predator swarm, same WCAG 1.4.1 rationale as
// bedPestPhrase above).
export function bedPredatorPhrase(predators: readonly { predatorKey: string; population: number }[]): string | null {
  const active = predators.filter((predator) => predator.population >= MIN_DISPLAY_POPULATION);
  if (active.length === 0) {
    return null;
  }
  return active.map((predator) => `${PREDATOR_LABEL[predator.predatorKey] ?? predator.predatorKey} active`).join(", ");
}

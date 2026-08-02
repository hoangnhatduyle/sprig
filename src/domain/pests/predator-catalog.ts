// Predator config for the Lotka-Volterra predator-prey pairing (architecture
// doc §10). Each predator preys on an explicit list of pest-catalog.ts keys
// (not "all pests uniformly") so a ladybug release genuinely targets aphids
// specifically, the doc's own worked example, while a broader
// "general-beneficials" population covers the rest.

export interface PredatorDefinition {
  key: string;
  displayName: string;
  preyPestKeys: readonly string[];
  // Lotka-Volterra predator-side rate: predator population growth per unit
  // (prey population x predator population) eaten.
  predationGrowthRate: number;
  // Lotka-Volterra prey-side rate: prey population lost per unit (prey x
  // predator) — kept separate from predationGrowthRate because real
  // predators convert eaten prey to offspring inefficiently (a small
  // fraction of what they remove from the prey population), not 1:1.
  preyDeathRate: number;
  baseDeathRate: number;
  baseImmigrationRate: number;
  // Predator immigration is boosted by nearby flowering "insectary"
  // companion plants (marigold, dill) — architecture doc §10/§11, wired via
  // ecology-service.ts's PREDATOR_ATTRACT modifier.
  insectaryBoostMultiplier: number;
}

const ladybug: PredatorDefinition = {
  key: "ladybug",
  displayName: "Ladybug",
  preyPestKeys: ["aphid"],
  predationGrowthRate: 0.0025,
  preyDeathRate: 0.03,
  baseDeathRate: 0.12,
  baseImmigrationRate: 0.04,
  insectaryBoostMultiplier: 2,
};

const generalBeneficials: PredatorDefinition = {
  key: "general-beneficials",
  displayName: "General Beneficials",
  preyPestKeys: ["aphid", "caterpillar", "slug"],
  predationGrowthRate: 0.0012,
  preyDeathRate: 0.015,
  baseDeathRate: 0.1,
  baseImmigrationRate: 0.03,
  insectaryBoostMultiplier: 1.2,
};

export const PREDATOR_DEFINITIONS: readonly PredatorDefinition[] = [ladybug, generalBeneficials];

const PREDATOR_BY_KEY = new Map(PREDATOR_DEFINITIONS.map((predator) => [predator.key, predator]));

export function getPredatorDefinition(key: string): PredatorDefinition | undefined {
  return PREDATOR_BY_KEY.get(key);
}

export function predatorsForPest(pestKey: string): readonly PredatorDefinition[] {
  return PREDATOR_DEFINITIONS.filter((predator) => predator.preyPestKeys.includes(pestKey));
}

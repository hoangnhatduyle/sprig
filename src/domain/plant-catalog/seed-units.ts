// Purely a display/entry-preference vocabulary for stock quantities —
// Plant.seedQuantity is always canonical seed-equivalents regardless of
// which unit is chosen here (see inventory-service.ts). No Prisma import:
// this is read from both server actions and client components
// (InventoryPanel.tsx).

export const SEED_UNIT_OPTIONS = [
  "seed",
  "seedling",
  "cutting",
  "bulb",
  "tuber",
  "packet",
  "gram",
  "ounce",
  "pound",
  "bunch",
] as const;

export type SeedUnit = (typeof SEED_UNIT_OPTIONS)[number];

export const SEED_UNIT_LABELS: Record<SeedUnit, string> = {
  seed: "Seed",
  seedling: "Seedling / start",
  cutting: "Cutting",
  bulb: "Bulb",
  tuber: "Tuber",
  packet: "Packet",
  gram: "Gram",
  ounce: "Ounce",
  pound: "Pound",
  bunch: "Bunch",
};

export function isSeedUnit(value: string): value is SeedUnit {
  return (SEED_UNIT_OPTIONS as readonly string[]).includes(value);
}

import type { PlantOption } from "./types";

export function plantName(plants: PlantOption[], id: string): string {
  return plants.find((plant) => plant.id === id)?.commonName ?? id;
}

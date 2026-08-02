import type { PrismaClient } from "@prisma/client";
import type { GardenLocationCoords } from "./sun-times";

// GardenLocation is a singleton configuration row (see prisma/schema.prisma).
// Until the garden's real coordinates are entered it is legitimately absent,
// and sunrise/sunset still has to resolve to *something* for the viewer to
// render — so an explicit, documented mid-latitude fallback is used rather
// than throwing (which would black out the whole viewer over missing config)
// or silently defaulting to 0,0 (the Gulf of Guinea, a plausible-looking but
// wrong answer).
export const DEFAULT_GARDEN_LOCATION: GardenLocationCoords = {
  latitude: 40.7128,
  longitude: -74.006,
};

export async function getGardenLocation(prisma: PrismaClient): Promise<GardenLocationCoords> {
  const location = await prisma.gardenLocation.findFirst();
  if (!location) {
    return DEFAULT_GARDEN_LOCATION;
  }
  return { latitude: location.latitude, longitude: location.longitude };
}

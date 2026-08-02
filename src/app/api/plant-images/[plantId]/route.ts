import { readPlantImage } from "@/lib/plant-images";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ plantId: string }> },
): Promise<Response> {
  const { plantId } = await context.params;
  const plant = await prisma.plant.findUnique({
    where: { id: plantId },
    select: { imageFilename: true, imageMimeType: true },
  });
  if (!plant?.imageFilename || !plant.imageMimeType) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const image = await readPlantImage(plant.imageFilename);
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": plant.imageMimeType,
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

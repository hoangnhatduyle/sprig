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
        // public (not private): nothing here is per-viewer — the same
        // plantId always resolves to the same bytes for anyone who can hit
        // this route (there's no auth boundary to protect), so letting
        // Vercel's edge CDN cache the response, not just the browser, avoids
        // a Prisma + Vercel Blob round trip on every cache miss. Same
        // max-age as before — re-uploads (storePlantImage overwrites
        // imageFilename) stay visible within the same 1h window this route
        // already tolerated under "private".
        "Cache-Control": "public, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

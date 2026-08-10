import { readLiveImage } from "@/lib/live-images";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await context.params;
  const image = await prisma.liveImage.findUnique({
    where: { id },
    select: { photoFilename: true, photoMimeType: true },
  });
  if (!image) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const bytes = await readLiveImage(image.photoFilename);
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": image.photoMimeType,
        // public + immutable: photoFilename is set once at creation and
        // never updated (deleting a LiveImage removes the whole row, it
        // never swaps the photo underneath an existing id), so a given id's
        // photo bytes can never change. Safe to let both the browser and
        // Vercel's edge CDN cache indefinitely instead of re-hitting Prisma
        // + Vercel Blob on every cache miss.
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

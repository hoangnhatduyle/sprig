import { readJournalPhoto } from "@/lib/journal-photos";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ noteId: string }> },
): Promise<Response> {
  const { noteId } = await context.params;
  const note = await prisma.journalNote.findUnique({
    where: { id: noteId },
    select: { photoFilename: true, photoMimeType: true },
  });
  if (!note?.photoFilename || !note.photoMimeType) {
    return new Response("Not found", { status: 404 });
  }
  try {
    const image = await readJournalPhoto(note.photoFilename);
    return new Response(new Uint8Array(image), {
      headers: {
        "Content-Type": note.photoMimeType,
        // public + immutable: JournalNote is append-only (NC-SPRIG-JOURNAL-
        // NOTE-APPEND-ONLY — see prisma/schema.prisma) and photoFilename is
        // set once at creation, never updated, so a given noteId's photo
        // bytes can never change. Safe to let both the browser and Vercel's
        // edge CDN cache indefinitely instead of re-hitting Prisma + Vercel
        // Blob on every cache miss; there's no per-viewer auth boundary to
        // protect by keeping this "private".
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

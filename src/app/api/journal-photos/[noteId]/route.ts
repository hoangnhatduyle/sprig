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
        "Cache-Control": "private, max-age=3600",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

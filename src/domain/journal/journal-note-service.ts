// User-authored freeform notes (SPEC-JOURNAL-001) — the one journal entry
// kind with its own dedicated write path (every other kind is recorded as a
// side effect of an existing action service). Distinct from CareActionEvent:
// this is a human observation ("aphids showed up today"), not a system-
// recorded outcome of an action.

import type { JournalNote, PrismaClient } from "@prisma/client";
import { JournalValidationError } from "./errors";

export interface CreateJournalNoteInput {
  bedId?: string | null;
  column?: number | null;
  row?: number | null;
  body?: string | null;
  photoFilename?: string | null;
  photoMimeType?: string | null;
  occurredAt?: Date;
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export async function createJournalNote(
  prisma: PrismaClient,
  input: CreateJournalNoteInput,
): Promise<JournalNote> {
  const body = optionalText(input.body);
  if (!body && !input.photoFilename) {
    throw new JournalValidationError("A note needs either some text or a photo.");
  }
  const hasCellCoordinates = input.column != null || input.row != null;
  if (hasCellCoordinates && !input.bedId) {
    throw new JournalValidationError("A cell-scoped note requires a bed.");
  }

  let cellId: string | null = null;
  if (input.bedId && input.column != null && input.row != null) {
    const cell = await prisma.gridCell.findUniqueOrThrow({
      where: { bedId_column_row: { bedId: input.bedId, column: input.column, row: input.row } },
    });
    cellId = cell.id;
  }

  return prisma.journalNote.create({
    data: {
      bedId: input.bedId ?? null,
      cellId,
      body,
      photoFilename: input.photoFilename ?? null,
      photoMimeType: input.photoMimeType ?? null,
      occurredAt: input.occurredAt ?? new Date(),
    },
  });
}

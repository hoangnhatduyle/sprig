// LiveImage diary CRUD (SPEC-LIVE-IMAGES) — a garden-wide photo diary,
// distinct from JournalNote's optional per-note photo. One-table reads, so
// unlike getGardenJournal (a multi-table merge) this stays a plain
// findMany/create/delete with no separate read-model file.

import type { LiveImage, PrismaClient } from "@prisma/client";
import { LiveImageValidationError } from "./errors";

export interface CreateLiveImageInput {
  photoFilename: string;
  photoMimeType: string;
  capturedAt: Date;
}

export async function createLiveImage(prisma: PrismaClient, input: CreateLiveImageInput): Promise<LiveImage> {
  if (Number.isNaN(input.capturedAt.getTime())) {
    throw new LiveImageValidationError("Choose a valid date for this photo.");
  }
  return prisma.liveImage.create({
    data: {
      photoFilename: input.photoFilename,
      photoMimeType: input.photoMimeType,
      capturedAt: input.capturedAt,
    },
  });
}

export async function listLiveImages(prisma: PrismaClient): Promise<LiveImage[]> {
  return prisma.liveImage.findMany({ orderBy: { capturedAt: "desc" } });
}

export async function deleteLiveImage(prisma: PrismaClient, id: string): Promise<LiveImage> {
  return prisma.liveImage.delete({ where: { id } });
}

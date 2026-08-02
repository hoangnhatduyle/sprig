// Storage for JournalNote photos — same validation/safety shape as
// src/lib/plant-images.ts (MIME/size checks, UUID-keyed blobs, hostname-
// validated reads/deletes), but a separate Vercel Blob path prefix and a
// separate small module: plant-images.ts is keyed one-photo-per-Plant
// (overwritten on re-upload, no history); journal photos are one-per-note,
// keyed by date/bed/cell, so the two aren't the same resource even though
// the storage-handling logic looks identical.

import { randomUUID } from "node:crypto";
import { del, put } from "@vercel/blob";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PATH_PREFIX = "journal-photos/";
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export class JournalPhotoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JournalPhotoError";
  }
}

// `filename` here is the full Vercel Blob URL returned by `put` (stored
// verbatim in JournalNote.photoFilename) — validated against Vercel Blob's
// own hostname pattern before every read/delete so a corrupted/foreign DB
// value can never turn into an arbitrary server-side fetch (SSRF).
function safeBlobUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new JournalPhotoError("Invalid image path.");
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".public.blob.vercel-storage.com") ||
    !parsed.pathname.startsWith(`/${PATH_PREFIX}`)
  ) {
    throw new JournalPhotoError("Invalid image path.");
  }
  return url;
}

export async function storeJournalPhoto(file: File): Promise<{ filename: string; mimeType: string }> {
  const extension = EXTENSIONS[file.type];
  if (!extension) throw new JournalPhotoError("Use a JPEG, PNG, WebP, or GIF image.");
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new JournalPhotoError("Image must be between 1 byte and 5 MB.");
  }
  const pathname = `${PATH_PREFIX}${randomUUID()}${extension}`;
  const blob = await put(pathname, Buffer.from(await file.arrayBuffer()), {
    access: "public",
    addRandomSuffix: false,
    contentType: file.type,
  });
  return { filename: blob.url, mimeType: file.type };
}

export async function readJournalPhoto(filename: string): Promise<Buffer> {
  const response = await fetch(safeBlobUrl(filename));
  if (!response.ok) throw new JournalPhotoError("Image not found.");
  return Buffer.from(await response.arrayBuffer());
}

export async function removeJournalPhoto(filename: string | null): Promise<void> {
  if (!filename) return;
  await del(safeBlobUrl(filename));
}

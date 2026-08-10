// Storage for LiveImage diary photos — same validation/safety shape as
// src/lib/journal-photos.ts (MIME/size checks, UUID-keyed blobs, hostname-
// validated reads/deletes), but its own Vercel Blob path prefix: a
// LiveImage is a standalone garden-diary photo, not attached to a
// JournalNote or Plant, so it gets its own storage namespace even though
// the read/write logic is identical.

import { randomUUID } from "node:crypto";
import { del, get, put } from "@vercel/blob";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PATH_PREFIX = "live-images/";
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

export class LiveImageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LiveImageError";
  }
}

// `filename` here is the full Vercel Blob URL returned by `put` (stored
// verbatim in LiveImage.photoFilename) — validated against Vercel Blob's
// own hostname pattern before every read/delete so a corrupted/foreign DB
// value can never turn into an arbitrary server-side fetch (SSRF).
// Deliberately not pinned to ".public." — this store is configured for
// private access (Vercel fixes that at the store level, not per-call), so
// blob URLs come back as "<storeId>.private.blob.vercel-storage.com".
function safeBlobUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LiveImageError("Invalid image path.");
  }
  if (
    parsed.protocol !== "https:" ||
    !parsed.hostname.endsWith(".blob.vercel-storage.com") ||
    !parsed.pathname.startsWith(`/${PATH_PREFIX}`)
  ) {
    throw new LiveImageError("Invalid image path.");
  }
  return url;
}

export async function storeLiveImage(file: File): Promise<{ filename: string; mimeType: string }> {
  const extension = EXTENSIONS[file.type];
  if (!extension) throw new LiveImageError("Use a JPEG, PNG, WebP, or GIF image.");
  if (file.size === 0 || file.size > MAX_IMAGE_BYTES) {
    throw new LiveImageError("Image must be between 1 byte and 5 MB.");
  }
  const pathname = `${PATH_PREFIX}${randomUUID()}${extension}`;
  const blob = await put(pathname, Buffer.from(await file.arrayBuffer()), {
    access: "private",
    addRandomSuffix: false,
    contentType: file.type,
  });
  return { filename: blob.url, mimeType: file.type };
}

// Never exposed to the client directly — always read server-side and
// streamed back through /api/live-images/[id], so an authenticated `get()`
// (private access, via BLOB_READ_WRITE_TOKEN) is fine here; there's no
// public URL for the browser to hit.
export async function readLiveImage(filename: string): Promise<Buffer> {
  const result = await get(safeBlobUrl(filename), { access: "private" });
  if (!result || result.statusCode !== 200) throw new LiveImageError("Image not found.");
  return Buffer.from(await new Response(result.stream).arrayBuffer());
}

export async function removeLiveImage(filename: string | null): Promise<void> {
  if (!filename) return;
  await del(safeBlobUrl(filename));
}

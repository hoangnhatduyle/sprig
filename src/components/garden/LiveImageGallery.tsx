"use client";

// The garden's image diary (formerly a hardcoded static gallery — see git
// history for the old public/garden-live-images/ version). Users upload (or
// camera-capture on mobile) a photo of the physical garden and set the date
// it represents, so old photos can be backdated instead of always landing
// as "today". Photos persist via LiveImage (prisma/schema.prisma) + Vercel
// Blob (src/lib/live-images.ts), mirroring the Journal-photo upload path.

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { Upload, X } from "lucide-react";
import {
  createLiveImageAction,
  deleteLiveImageAction,
  getLiveImagesAction,
  type ActionResult,
  type LiveImageRecord,
} from "@/app/actions";
import { formatLiveImageDate } from "./date-display";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";

export interface LiveImageGalleryProps {
  initialLiveImages?: LiveImageRecord[];
  disabled?: boolean;
  getLiveImages?: () => Promise<LiveImageRecord[]>;
  createLiveImage?: (formData: FormData) => Promise<ActionResult>;
  deleteLiveImage?: (id: string) => Promise<ActionResult>;
}

interface DayGroup {
  dateLabel: string;
  images: LiveImageRecord[];
}

// Newest first, then bucketed by calendar day (UTC — capturedAt has no
// meaningful time-of-day component, it comes from a plain <input
// type="date">) so runs of same-day photos get one heading instead of
// repeating the date on every thumbnail.
function groupByDay(images: LiveImageRecord[]): DayGroup[] {
  const sorted = [...images].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
  const groups: DayGroup[] = [];
  for (const image of sorted) {
    const dayKey = image.capturedAt.slice(0, 10);
    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.images[0].capturedAt.slice(0, 10) === dayKey) {
      lastGroup.images.push(image);
    } else {
      groups.push({ dateLabel: formatLiveImageDate(image.capturedAt), images: [image] });
    }
  }
  return groups;
}

function EnlargedImageDialog({
  images,
  index,
  onClose,
  onNavigate,
}: {
  images: LiveImageRecord[];
  index: number;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const image = images[index];

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") onNavigate((index + 1) % images.length);
      else if (event.key === "ArrowLeft") onNavigate((index - 1 + images.length) % images.length);
    }
    document.addEventListener("keydown", handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [index, images.length, onClose, onNavigate]);

  const alt = `Garden photo from ${formatLiveImageDate(image.capturedAt)}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      role="presentation"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={alt}
        tabIndex={-1}
        className="relative flex h-full max-h-[85vh] w-full max-w-4xl flex-col items-center justify-center outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative h-full w-full">
          <Image src={`/api/live-images/${image.id}`} alt={alt} fill className="object-contain" sizes="90vw" />
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close enlarged photo"
          className={`absolute -top-2 right-0 rounded-full bg-black/70 px-3 py-1.5 text-lg font-semibold text-white ${FOCUS_RING}`}
        >
          ×
        </button>
        <button
          type="button"
          onClick={() => onNavigate((index - 1 + images.length) % images.length)}
          aria-label="Previous photo"
          className={`absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-xl text-white ${FOCUS_RING}`}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => onNavigate((index + 1) % images.length)}
          aria-label="Next photo"
          className={`absolute right-0 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-xl text-white ${FOCUS_RING}`}
        >
          ›
        </button>
        <p className="mt-2 text-sm text-white/80">
          {formatLiveImageDate(image.capturedAt)} · {index + 1} of {images.length}
        </p>
      </div>
    </div>
  );
}

export function LiveImageGallery({
  initialLiveImages,
  disabled = false,
  getLiveImages = getLiveImagesAction,
  createLiveImage = createLiveImageAction,
  deleteLiveImage = deleteLiveImageAction,
}: LiveImageGalleryProps) {
  const [images, setImages] = useState<LiveImageRecord[]>(initialLiveImages ?? []);
  const [enlargedIndex, setEnlargedIndex] = useState<number | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [capturedAt, setCapturedAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isFirstRender = useRef(true);
  useEffect(() => {
    // First mount already has SSR-seeded data (initialLiveImages, via
    // page.tsx's listLiveImages call) — skip the redundant fetch then. A
    // test/context without initialLiveImages still gets its first fetch.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (initialLiveImages) return;
    }
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refresh(): Promise<void> {
    try {
      setImages(await getLiveImages());
    } catch {
      // Keep showing whatever's already rendered — a stale gallery beats an
      // empty one for a transient network hiccup.
    }
  }

  async function handleUpload(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (uploadBusy || !file) return;
    setUploadBusy(true);
    setUploadMessage(null);
    try {
      const formData = new FormData();
      formData.set("image", file);
      formData.set("capturedAt", capturedAt);
      const result = await createLiveImage(formData);
      if (!result.ok) {
        setUploadMessage(result.error ?? "Couldn't save that photo.");
        return;
      }
      setFile(null);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setUploadMessage("Photo added.");
      await refresh();
    } catch {
      setUploadMessage("Couldn't reach the server. Try again.");
    } finally {
      setUploadBusy(false);
    }
  }

  function clearSelectedFile(): void {
    setFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }

  async function handleDelete(id: string): Promise<void> {
    if (!window.confirm("Delete this photo? This can't be undone.")) return;
    const result = await deleteLiveImage(id);
    if (result.ok) {
      setImages((current) => current.filter((image) => image.id !== id));
    } else {
      setUploadMessage(result.error ?? "Couldn't delete that photo.");
    }
  }

  const groups = groupByDay(images);
  const flatImages = groups.flatMap((group) => group.images);

  return (
    <section aria-label="Live garden reference photos">
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        A photo diary of the physical garden — upload a photo, set the date it represents, and watch the garden
        change over time.
      </p>

      <form
        onSubmit={(event) => void handleUpload(event)}
        className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border p-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium">Photo</span>
          <div className="flex flex-wrap items-center gap-2">
            <label
              htmlFor="live-image-file"
              className={`inline-flex ${MIN_TOUCH_TARGET} items-center gap-2 rounded-md border px-3 text-sm font-semibold transition-colors ${FOCUS_RING} ${
                disabled || uploadBusy
                  ? "cursor-not-allowed opacity-50"
                  : "cursor-pointer hover:bg-[var(--color-surface-raised)]"
              }`}
              style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
            >
              <Upload aria-hidden="true" className="h-4 w-4 shrink-0" />
              Choose photo
            </label>
            <input
              ref={fileInputRef}
              id="live-image-file"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              capture="environment"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              disabled={disabled || uploadBusy}
              className="sr-only"
            />
            {file ? (
              <span
                className="inline-flex items-center gap-1.5 rounded-full border py-1 pl-2.5 pr-1.5 text-xs font-medium"
                style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
              >
                {file.name}
                <button
                  type="button"
                  onClick={clearSelectedFile}
                  disabled={disabled || uploadBusy}
                  aria-label="Clear selected photo"
                  className={`rounded-full p-0.5 disabled:cursor-not-allowed ${FOCUS_RING}`}
                >
                  <X aria-hidden="true" className="h-3 w-3 shrink-0" />
                </button>
              </span>
            ) : (
              <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>
                No file chosen
              </span>
            )}
          </div>
        </div>
        <label className="text-sm font-medium" htmlFor="live-image-date">
          Date taken
          <input
            id="live-image-date"
            type="date"
            value={capturedAt}
            onChange={(event) => setCapturedAt(event.target.value)}
            disabled={disabled || uploadBusy}
            className={`mt-1 block ${MIN_TOUCH_TARGET} rounded-md border bg-[var(--color-surface)] px-3 text-sm`}
            style={{ borderColor: "var(--color-border)" }}
          />
        </label>
        <button
          type="submit"
          disabled={disabled || uploadBusy || !file}
          className={`${MIN_TOUCH_TARGET} rounded-md bg-[var(--color-cta-bg)] px-4 text-sm font-semibold text-[var(--color-cta-text)] disabled:opacity-50 ${FOCUS_RING}`}
        >
          {uploadBusy ? "Saving…" : "Add photo"}
        </button>
        {uploadMessage && (
          <p role="status" className="w-full text-sm" style={{ color: "var(--color-text-muted)" }}>
            {uploadMessage}
          </p>
        )}
      </form>

      {groups.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          No photos yet — add one above to start your garden diary.
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((group) => (
            <div key={group.dateLabel}>
              <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>
                {group.dateLabel}
              </h3>
              <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: "x proximity" }}>
                {group.images.map((image) => (
                  <div key={image.id} className="relative shrink-0" style={{ scrollSnapAlign: "start" }}>
                    <button
                      type="button"
                      onClick={() => setEnlargedIndex(flatImages.findIndex((candidate) => candidate.id === image.id))}
                      aria-label={`Enlarge photo from ${formatLiveImageDate(image.capturedAt)}`}
                      style={{ borderColor: "var(--color-border)" }}
                      className={`relative aspect-[4/3] h-64 overflow-hidden rounded-lg border-2 transition-transform hover:-translate-y-0.5 hover:shadow-md sm:h-80 lg:h-96 ${FOCUS_RING}`}
                    >
                      <Image
                        src={`/api/live-images/${image.id}`}
                        alt={`Garden photo from ${formatLiveImageDate(image.capturedAt)}`}
                        fill
                        className="object-cover"
                        sizes="(min-width: 1024px) 32rem, (min-width: 640px) 27rem, 21rem"
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDelete(image.id)}
                      disabled={disabled}
                      aria-label={`Delete photo from ${formatLiveImageDate(image.capturedAt)}`}
                      className={`absolute right-1.5 top-1.5 rounded-full bg-black/70 px-2 py-1 text-xs font-semibold text-white disabled:opacity-50 ${FOCUS_RING}`}
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {enlargedIndex !== null && (
        <EnlargedImageDialog
          images={flatImages}
          index={enlargedIndex}
          onClose={() => setEnlargedIndex(null)}
          onNavigate={setEnlargedIndex}
        />
      )}
    </section>
  );
}

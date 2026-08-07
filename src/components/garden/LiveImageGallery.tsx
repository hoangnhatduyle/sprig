"use client";

// Reference photos of the physical garden, for comparing against the bed
// layout while planning. Static assets shipped from public/ (not read from
// disk at request time) — see plant-images.ts / journal-photos.ts for why
// this project moved off local-filesystem reads for anything served in
// production: a Vercel serverless function isn't guaranteed to have
// arbitrary non-public/ directories in its bundle, and public/ is the one
// directory Next.js guarantees gets deployed statically.

import Image from "next/image";
import { useEffect, useRef, useState } from "react";
import { FOCUS_RING } from "./ui-constants";

interface LiveImage {
  src: string;
  alt: string;
}

const LIVE_IMAGES: readonly LiveImage[] = [
  { src: "/garden-live-images/garden-live-01.jpg", alt: "Garden reference photo 1" },
  { src: "/garden-live-images/garden-live-02.jpg", alt: "Garden reference photo 2" },
  { src: "/garden-live-images/garden-live-03.jpg", alt: "Garden reference photo 3" },
  { src: "/garden-live-images/garden-live-04.jpg", alt: "Garden reference photo 4" },
  { src: "/garden-live-images/garden-live-05.jpg", alt: "Garden reference photo 5" },
  { src: "/garden-live-images/garden-live-06.jpg", alt: "Garden reference photo 6" },
  { src: "/garden-live-images/rain-barrel-01.png", alt: "Rain barrel reference photo 1" },
  { src: "/garden-live-images/rain-barrel-02.png", alt: "Rain barrel reference photo 2" },
];

function EnlargedImageDialog({
  index,
  onClose,
  onNavigate,
}: {
  index: number;
  onClose: () => void;
  onNavigate: (nextIndex: number) => void;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const image = LIVE_IMAGES[index];

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
      else if (event.key === "ArrowRight") onNavigate((index + 1) % LIVE_IMAGES.length);
      else if (event.key === "ArrowLeft") onNavigate((index - 1 + LIVE_IMAGES.length) % LIVE_IMAGES.length);
    }
    document.addEventListener("keydown", handleKeyDown);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [index, onClose, onNavigate]);

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
        aria-label={image.alt}
        tabIndex={-1}
        className="relative flex h-full max-h-[85vh] w-full max-w-4xl flex-col items-center justify-center outline-none"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="relative h-full w-full">
          <Image src={image.src} alt={image.alt} fill className="object-contain" sizes="90vw" />
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
          onClick={() => onNavigate((index - 1 + LIVE_IMAGES.length) % LIVE_IMAGES.length)}
          aria-label="Previous photo"
          className={`absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-xl text-white ${FOCUS_RING}`}
        >
          ‹
        </button>
        <button
          type="button"
          onClick={() => onNavigate((index + 1) % LIVE_IMAGES.length)}
          aria-label="Next photo"
          className={`absolute right-0 top-1/2 -translate-y-1/2 rounded-full bg-black/60 px-3 py-2 text-xl text-white ${FOCUS_RING}`}
        >
          ›
        </button>
        <p className="mt-2 text-sm text-white/80">
          {index + 1} of {LIVE_IMAGES.length}
        </p>
      </div>
    </div>
  );
}

export function LiveImageGallery() {
  const [enlargedIndex, setEnlargedIndex] = useState<number | null>(null);

  return (
    <section aria-label="Live garden reference photos">
      <p className="mb-3 text-sm" style={{ color: "var(--color-text-muted)" }}>
        Real photos of the physical garden, for reference while planning bed layout.
      </p>
      <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollSnapType: "x proximity" }}>
        {LIVE_IMAGES.map((image, index) => (
          <button
            key={image.src}
            type="button"
            onClick={() => setEnlargedIndex(index)}
            aria-label={`Enlarge ${image.alt}`}
            style={{ borderColor: "var(--color-border)", scrollSnapAlign: "start" }}
            className={`relative aspect-[4/3] h-64 shrink-0 overflow-hidden rounded-lg border-2 transition-transform hover:-translate-y-0.5 hover:shadow-md sm:h-80 lg:h-96 ${FOCUS_RING}`}
          >
            <Image
              src={image.src}
              alt={image.alt}
              fill
              className="object-cover"
              sizes="(min-width: 1024px) 32rem, (min-width: 640px) 27rem, 21rem"
            />
          </button>
        ))}
      </div>
      {enlargedIndex !== null && (
        <EnlargedImageDialog index={enlargedIndex} onClose={() => setEnlargedIndex(null)} onNavigate={setEnlargedIndex} />
      )}
    </section>
  );
}

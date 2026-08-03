import { Droplet, Droplets, CloudRain, type LucideIcon } from "lucide-react";
import type { RainBarrelStatus } from "@prisma/client";

// Shared rain-barrel display data, same convention as status-display.ts/
// equipment-display.ts: one source of labels/colors/icons so a barrel reads
// the same everywhere it's shown (RainBarrelPanel today; the 3D legend and
// any future summary panel later).

export const RAIN_BARREL_STATUS_LABEL: Record<RainBarrelStatus, string> = {
  EMPTY: "Empty",
  PARTIAL: "Partial",
  FULL: "Full",
  OVERFLOWING: "Overflowing",
};

// OVERFLOWING intentionally reuses the app's shared warning surface
// (--color-warning-bg/text) rather than the water-blue family below — it's
// the same "needs attention" signal used elsewhere, not a fourth barrel
// color.
export const RAIN_BARREL_STATUS_STYLES: Record<RainBarrelStatus, string> = {
  EMPTY: "bg-[var(--rainbarrel-empty-bg)] border-[var(--rainbarrel-empty-border)]",
  PARTIAL: "bg-[var(--rainbarrel-partial-bg)] border-[var(--rainbarrel-partial-border)]",
  FULL: "bg-[var(--rainbarrel-full-bg)] border-[var(--rainbarrel-full-border)]",
  OVERFLOWING: "bg-[var(--color-warning-bg)] border-[var(--color-danger-text)] text-[var(--color-warning-text)]",
};

export const RAIN_BARREL_STATUS_ICON: Record<RainBarrelStatus, LucideIcon> = {
  EMPTY: Droplet,
  PARTIAL: Droplets,
  FULL: Droplets,
  OVERFLOWING: CloudRain,
};

// Reassurance-first: the pre-filled default is a genuinely usable value, not
// a placeholder the user is expected to replace with a precise measurement
// before the feature "works" — a real concern raised while building this
// (there's no house/roof modeled in the 3D scene, so this can never be
// derived automatically). The rule of thumb mirrors the constant in
// rain-barrel-service.ts (GALLONS_PER_SQFT_PER_INCH) so the UI's guidance and
// the server's actual math can never silently drift apart.
export const CATCHMENT_AREA_HELPER_TEXT =
  "Don't know the exact number? Leave this as-is — 300 sq ft is a reasonable placeholder for one downspout on a typical house, and it only affects how fast the barrel fills, not whether you can use it. Rule of thumb: 1 inch of rain over 1,000 sq ft ≈ 623 gallons. If you do know which downspout feeds this barrel, enter roughly that section of roof — not your whole roof.";

export function rainBarrelFillPercent(currentGallons: number, capacityGallons: number): number {
  if (capacityGallons <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((currentGallons / capacityGallons) * 100)));
}

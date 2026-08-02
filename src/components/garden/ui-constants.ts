// Shared Tailwind fragments — previously duplicated identically in
// CellPicker.tsx and ConditionsPanel.tsx; extracted here once a third/fourth
// consumer (WeatherBanner, SimClockControl) needed the same constants.

// 44px minimum touch target (WCAG 2.5.8).
export const MIN_TOUCH_TARGET = "min-h-11";

export const FOCUS_RING =
  "outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--color-clay)] focus-visible:ring-offset-[var(--color-ring-offset)]";

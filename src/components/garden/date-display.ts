// A shared formatter for the Journal feed's timestamps — a deliberate small
// deviation from the rest of this codebase's convention of inlining
// toLocaleDateString/toLocaleTimeString separately per component
// (WeatherBanner.tsx, SimClockControl.tsx, InventoryPanel.tsx each do their
// own). Justified here by entry volume: the Journal can render dozens of
// timestamps in one screen, so one shared helper is worth the small
// consistency deviation. Existing call sites are left untouched.

export function formatJournalTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

// A shared formatter for the Journal feed's timestamps — a deliberate small
// deviation from the rest of this codebase's convention of inlining
// toLocaleDateString/toLocaleTimeString separately per component
// (WeatherBanner.tsx, SimClockControl.tsx, InventoryPanel.tsx each do their
// own). Justified here by entry volume: the Journal can render dozens of
// timestamps in one screen, so one shared helper is worth the small
// consistency deviation. Existing call sites are left untouched.

// timeZone: "UTC" pinned so this renders identically on the server and on
// every visitor's browser — without it, the same Date formats to different
// text depending on the runtime's local zone, which is a hydration mismatch
// (React error #418) for any entry rendered on first paint, not just a
// cosmetic difference.
export function formatJournalTimestamp(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  });
}

"use client";

// Installed as a PWA on iPad, Sprig keeps running whatever bundle it loaded
// until the tab is closed and reopened — there's no browser reload button to
// fall back on. These two actions replace "delete and reinstall the app" as
// the fix, mirroring the same two-tier pattern (soft update check vs. hard
// cache wipe) used in cha-ching's AppUpdates and Inventory_Tracking_App's
// settings panel.
import { useState } from "react";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";

export function AppPanel() {
  const [checking, setChecking] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function checkForUpdates(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
      setMessage("Updates aren't available in this browser.");
      return;
    }
    setChecking(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
      window.location.reload();
    } catch {
      setMessage("Update check failed — try Refresh & empty cache below.");
      setChecking(false);
    }
  }

  async function refreshAndEmptyCache(): Promise<void> {
    setConfirmOpen(false);
    setClearing(true);
    setMessage(null);
    try {
      if ("serviceWorker" in navigator) {
        const registrations = await navigator.serviceWorker.getRegistrations();
        await Promise.all(registrations.map((registration) => registration.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
      window.location.reload();
    } catch {
      setMessage("Couldn't clear the cache — try closing and reopening the app.");
      setClearing(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold" style={{ fontFamily: "var(--font-display)" }}>
          App updates
        </h2>
        <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>
          Installed as an app, Sprig keeps running the version it had when it was last refreshed.
          If something looks out of date, try these instead of removing and re-adding it.
        </p>
      </div>

      {message && (
        <p
          role="alert"
          className="rounded-md px-3 py-2 text-sm"
          style={{ background: "var(--color-danger-bg)", color: "var(--color-danger-text)" }}
        >
          {message}
        </p>
      )}

      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border p-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div>
          <p className="text-sm font-medium">Check for updates</p>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Fetch and apply the latest version if one is available.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void checkForUpdates()}
          disabled={checking || clearing}
          className={`${MIN_TOUCH_TARGET} rounded-md border px-4 text-sm font-semibold disabled:opacity-50 ${FOCUS_RING}`}
          style={{ borderColor: "var(--color-border)" }}
        >
          {checking ? "Checking…" : "Check"}
        </button>
      </div>

      <div
        className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 rounded-lg border p-3"
        style={{ borderColor: "var(--color-border)" }}
      >
        <div>
          <p className="text-sm font-medium">Refresh &amp; empty cache</p>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
            Force a full reload and clear everything stored offline.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={checking || clearing}
          className={`${MIN_TOUCH_TARGET} rounded-md border px-4 text-sm font-semibold disabled:opacity-50 ${FOCUS_RING}`}
          style={{ borderColor: "var(--color-border)" }}
        >
          {clearing ? "Clearing…" : "Refresh"}
        </button>
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="refresh-cache-heading"
            className="w-full max-w-md rounded-xl border bg-[var(--color-surface-raised)] p-5 shadow-xl"
            style={{ borderColor: "var(--color-border)" }}
          >
            <h2 id="refresh-cache-heading" className="text-xl font-semibold">
              Refresh and empty cache?
            </h2>
            <p className="mt-2 text-sm" style={{ color: "var(--color-text-muted)" }}>
              This reloads the app and clears everything stored offline. Any unsaved changes on
              this page will be lost.
            </p>
            <div className="mt-5 flex gap-2">
              <button
                type="button"
                onClick={() => void refreshAndEmptyCache()}
                className={`${MIN_TOUCH_TARGET} rounded-md bg-[var(--color-cta-bg)] px-4 font-semibold text-[var(--color-cta-text)] ${FOCUS_RING}`}
              >
                Refresh
              </button>
              <button
                type="button"
                onClick={() => setConfirmOpen(false)}
                className={`${MIN_TOUCH_TARGET} rounded-md border px-4 ${FOCUS_RING}`}
                style={{ borderColor: "var(--color-border)" }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

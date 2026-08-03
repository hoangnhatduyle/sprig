"use client";

// The one control surface for src/domain/growth/sim-clock-service.ts's
// SimClockEpoch — previously setClockRate had no action and no UI at all,
// so the clock silently sat at its no-epoch default (1x real time) and
// every other Phase A signal (weather, equipment effects, growth) would
// have appeared frozen. Presets only, per SPEC-SURFACE-001 — no free-text
// rate, no scrub-back/epoch-history UI (that's a later-phase concern).

import { useEffect, useRef, useState } from "react";
import { FastForward, Pause, Play, RotateCcw } from "lucide-react";
import { resetSimClockToNowAction, setClockRateAction } from "@/app/actions";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import { useHydrated } from "./use-hydrated";

const RATE_PRESETS = [
  { rate: 0, label: "Paused", icon: Pause },
  { rate: 1, label: "Real time", icon: Play },
  { rate: 60, label: "Fast (1 day/min)", icon: FastForward },
  { rate: 720, label: "Very fast (12 days/min)", icon: FastForward },
  { rate: 1000, label: "Max", icon: FastForward },
] as const;

// Catch-up-service.ts's own MAX_CATCH_UP_DAYS cap bounds any single refresh
// regardless of how long the poll interval or a closed tab let sim time
// drift — this interval just decides how often the UI asks, not how much
// work one refresh can do.
const AUTO_ADVANCE_POLL_MS = 25_000;
// How often the live clock readout below re-renders between real
// server refreshes — purely a display tick (see the anchor/extrapolation
// comment below), never a network call.
const CLOCK_TICK_MS = 1000;

// `useLocalZone` false pins UTC for the one render that has to byte-for-byte
// match the server (see useHydrated) — the server (Vercel, always UTC) and a
// visitor's browser (their own zone) formatting the same Date via
// `undefined` produce different text, which is a hydration mismatch (React
// error #418), not just a cosmetic difference. Once hydrated, true switches
// to the viewer's actual local zone (`undefined`) so the "real time" clock
// shows their real wall-clock time instead of UTC.
function formatLiveClock(date: Date, useLocalZone: boolean): string {
  const timeZone = useLocalZone ? undefined : "UTC";
  const datePart = date.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone,
  });
  const timePart = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  });
  return `${datePart} · ${timePart}`;
}

export interface SimClockControlProps {
  clockRate: number;
  simTimeIso: string;
  onAdvance: () => Promise<void>;
  disabled?: boolean;
}

export function SimClockControl({ clockRate, simTimeIso, onAdvance, disabled = false }: SimClockControlProps) {
  const hydrated = useHydrated();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  // Remembers the last nonzero rate the user picked, so the Pause/Resume
  // toggle button knows what to resume TO — set from the dropdown/toggle
  // handler below (a plain event-handler update, not an effect), never from
  // clockRate going to 0 itself.
  const [lastActiveRate, setLastActiveRate] = useState(clockRate > 0 ? clockRate : 1);

  async function handleRateChange(nextRate: number): Promise<void> {
    if (busy) return;
    if (nextRate > 0) {
      setLastActiveRate(nextRate);
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await setClockRateAction(nextRate);
      if (!result.ok) {
        setMessage(result.error ?? "Couldn't change the clock rate.");
        return;
      }
      await onAdvance();
    } catch {
      setMessage("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleTogglePause(): Promise<void> {
    await handleRateChange(clockRate > 0 ? 0 : lastActiveRate);
  }

  async function handleAdvanceNow(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      await onAdvance();
    } catch {
      setMessage("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function handleResetToNow(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await resetSimClockToNowAction();
      if (!result.ok) {
        setMessage(result.error ?? "Couldn't reset to the current time.");
        return;
      }
      await onAdvance();
    } catch {
      setMessage("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  // Only polls while the clock is actually running faster than real time
  // and the tab is visible — a paused or 1x clock has nothing new to fetch,
  // and a backgrounded tab shouldn't burn requests it can't show anyway.
  useEffect(() => {
    if (clockRate <= 1) {
      return;
    }
    const id = setInterval(() => {
      if (document.visibilityState === "visible") {
        void onAdvance();
      }
    }, AUTO_ADVANCE_POLL_MS);
    return () => clearInterval(id);
  }, [clockRate, onAdvance]);

  // A visible, ticking clock (not just a date that updates only when a
  // server refresh happens to land) — extrapolated client-side from the
  // last known (simTime, realTime) anchor pair using the exact same
  // simAnchorAt + elapsedRealMs*rate formula sim-clock-service.ts's
  // getCurrentSimTime uses server-side. Never itself a source of truth: the
  // anchor is re-captured from `simTimeIso` every time a real refresh
  // lands, so this can't compound drift across many 1-second ticks.
  const anchorRef = useRef({ simTimeMs: new Date(simTimeIso).getTime(), realTimeMs: Date.now() });
  const [liveSimTime, setLiveSimTime] = useState(() => new Date(simTimeIso));

  useEffect(() => {
    anchorRef.current = { simTimeMs: new Date(simTimeIso).getTime(), realTimeMs: Date.now() };
    setLiveSimTime(new Date(simTimeIso));
  }, [simTimeIso, clockRate]);

  useEffect(() => {
    if (clockRate <= 0) {
      return;
    }
    const id = setInterval(() => {
      const { simTimeMs, realTimeMs } = anchorRef.current;
      setLiveSimTime(new Date(simTimeMs + (Date.now() - realTimeMs) * clockRate));
    }, CLOCK_TICK_MS);
    return () => clearInterval(id);
  }, [clockRate]);

  const isPaused = clockRate <= 0;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="sim-clock-rate" className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>
        Simulation speed
      </label>
      <p className="font-mono text-lg" style={{ color: "var(--color-text)" }} aria-live="off">
        {formatLiveClock(liveSimTime, hydrated)}
      </p>
      {/* Dropdown and buttons are siblings in one row (not the label wrapping
          the select) so `items-center` aligns them by their own shared
          min-h-11 height — previously the label's own line box pushed the
          select down a line while the button stayed put, so the two never
          lined up. */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void handleTogglePause()}
          aria-pressed={isPaused}
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 ${MIN_TOUCH_TARGET} text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
          style={{ borderColor: "var(--color-border)" }}
        >
          {isPaused ? <Play aria-hidden="true" className="h-4 w-4 shrink-0" /> : <Pause aria-hidden="true" className="h-4 w-4 shrink-0" />}
          {isPaused ? "Resume" : "Pause"}
        </button>
        <select
          id="sim-clock-rate"
          value={clockRate}
          disabled={disabled || busy}
          onChange={(event) => void handleRateChange(Number(event.target.value))}
          className={`${MIN_TOUCH_TARGET} rounded-md border bg-[var(--color-surface)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-60`}
          style={{ borderColor: "var(--color-border)", color: "var(--color-text)" }}
        >
          {RATE_PRESETS.map((preset) => (
            <option key={preset.rate} value={preset.rate}>
              {preset.label}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void handleAdvanceNow()}
          className={`rounded-md border px-3 ${MIN_TOUCH_TARGET} text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
          style={{ borderColor: "var(--color-border)" }}
        >
          Advance now
        </button>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={() => void handleResetToNow()}
          title="Snap the simulated date/time back to right now, without changing the speed."
          className={`inline-flex items-center gap-1.5 rounded-md border px-3 ${MIN_TOUCH_TARGET} text-sm font-medium disabled:cursor-not-allowed disabled:opacity-60 ${FOCUS_RING}`}
          style={{ borderColor: "var(--color-border)" }}
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4 shrink-0" />
          Jump to now
        </button>
        {message && (
          <p role="status" className="basis-full text-xs" style={{ color: "var(--color-text-muted)" }}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}

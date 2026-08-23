"use client";

// Settings for the real automated irrigation schedule (SPEC-IRRIGATION-001
// v0.2.0) — a manual pause plus a rain-skip threshold, mirroring how a real
// smart controller with a rain sensor behaves. Placed alongside
// RainBarrelPanel since both are water-management controls, same "standalone
// sibling of the bed grid" placement philosophy that panel's own header
// comment already establishes.

import { useState } from "react";
import { updateIrrigationSettingsAction } from "@/app/actions";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import type { SnapshotIrrigationSystem } from "./types";

export interface IrrigationSettingsPanelProps {
  irrigationSystems: SnapshotIrrigationSystem[];
  disabled?: boolean;
  onChanged?: () => Promise<void>;
}

interface IrrigationSystemCardProps {
  system: SnapshotIrrigationSystem;
  disabled: boolean;
  onChanged?: () => Promise<void>;
}

function IrrigationSystemCard({ system, disabled, onChanged }: IrrigationSystemCardProps) {
  const [enabled, setEnabled] = useState(system.enabled);
  const [rainSkipEnabled, setRainSkipEnabled] = useState(system.rainSkipEnabled);
  const [thresholdInput, setThresholdInput] = useState(String(system.rainSkipThresholdMm));
  const [lookbackInput, setLookbackInput] = useState(String(system.rainSkipLookbackDays));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  const threshold = Number(thresholdInput);
  const lookback = Number(lookbackInput);
  const hasPendingChanges =
    enabled !== system.enabled ||
    rainSkipEnabled !== system.rainSkipEnabled ||
    threshold !== system.rainSkipThresholdMm ||
    lookback !== system.rainSkipLookbackDays;
  const willSkipNextWindow = rainSkipEnabled && system.recentRainfallMm >= system.rainSkipThresholdMm;

  async function handleSave(): Promise<void> {
    if (busy || !Number.isFinite(threshold) || threshold < 0 || !Number.isInteger(lookback) || lookback <= 0) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const result = await updateIrrigationSettingsAction(system.id, {
        enabled,
        rainSkipEnabled,
        rainSkipThresholdMm: threshold,
        rainSkipLookbackDays: lookback,
      });
      if (!result.ok) {
        setMessageIsError(true);
        setMessage(result.error ?? "Couldn't save irrigation settings.");
        return;
      }
      await onChanged?.();
      setMessageIsError(false);
      setMessage("Irrigation settings saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      className="flex flex-col gap-3 rounded-xl border p-3 sm:p-4"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="font-semibold" style={{ color: "var(--color-text)" }}>
          {system.bedNames.length > 0 ? system.bedNames.join(" + ") : "Irrigation"} — {system.dailyStartTimes.join(", ")}
        </p>
        <span
          className="rounded-full border px-2 py-0.5 text-xs font-medium"
          style={{ borderColor: "var(--color-border)", color: "var(--color-text-muted)" }}
        >
          {system.status === "RUNNING" ? "Watering now" : "Idle"}
        </span>
      </div>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => setEnabled(event.target.checked)}
          disabled={disabled || busy}
          className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} h-5 w-5 shrink-0`}
        />
        Automatic watering enabled
      </label>

      <label className="flex items-center gap-2 text-sm font-medium">
        <input
          type="checkbox"
          checked={rainSkipEnabled}
          onChange={(event) => setRainSkipEnabled(event.target.checked)}
          disabled={disabled || busy}
          className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} h-5 w-5 shrink-0`}
        />
        Skip watering after enough rain
      </label>

      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1 text-sm font-medium">
          Skip threshold (mm)
          <input
            type="number"
            min="0"
            step="any"
            value={thresholdInput}
            onChange={(event) => setThresholdInput(event.target.value)}
            disabled={disabled || busy || !rainSkipEnabled}
            className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} w-28 rounded-md border bg-[var(--color-surface)] px-2 disabled:opacity-50`}
            style={{ borderColor: "var(--color-border)" }}
          />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          Over the last (days)
          <input
            type="number"
            min="1"
            step="1"
            value={lookbackInput}
            onChange={(event) => setLookbackInput(event.target.value)}
            disabled={disabled || busy || !rainSkipEnabled}
            className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} w-28 rounded-md border bg-[var(--color-surface)] px-2 disabled:opacity-50`}
            style={{ borderColor: "var(--color-border)" }}
          />
        </label>
      </div>

      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {system.recentRainfallMm.toFixed(1)}mm of rain over the last {system.rainSkipLookbackDays}{" "}
        day{system.rainSkipLookbackDays === 1 ? "" : "s"}
        {willSkipNextWindow ? " — the next scheduled watering will be skipped." : "."}
      </p>

      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={disabled || busy || !hasPendingChanges}
        className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} self-start rounded-md bg-[var(--color-cta-bg)] px-3 text-sm font-semibold text-[var(--color-cta-text)] disabled:opacity-50`}
      >
        Save
      </button>

      {message && (
        <p
          role={messageIsError ? "alert" : "status"}
          className="text-sm"
          style={{ color: messageIsError ? "var(--color-danger-text)" : "var(--color-text-muted)" }}
        >
          {message}
        </p>
      )}
    </li>
  );
}

export function IrrigationSettingsPanel({ irrigationSystems, disabled = false, onChanged }: IrrigationSettingsPanelProps) {
  if (irrigationSystems.length === 0) {
    return null;
  }

  return (
    <section
      aria-label="Irrigation settings"
      className="flex flex-col gap-2 rounded-xl border p-3 sm:p-4"
      style={{ borderColor: "var(--color-border)" }}
    >
      <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        Irrigation
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {irrigationSystems.map((system) => (
          <IrrigationSystemCard key={system.id} system={system} disabled={disabled} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}

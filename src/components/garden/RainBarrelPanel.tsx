"use client";

// Rain barrels are standalone yard objects, not bed-scoped equipment (the 3D
// model places both beside the garden, not inside either bed — see
// prisma/schema.prisma's RainBarrel, which has no bedId). This panel is
// therefore an unconditional sibling of the bed grid, same placement
// philosophy as NeedsAttentionBanner, rather than living inside GardenGrid
// or a per-bed card.

import { useState } from "react";
import { addRainBarrelWaterAction, drawRainBarrelWaterAction, updateRainBarrelCatchmentAreaAction } from "@/app/actions";
import {
  CATCHMENT_AREA_HELPER_TEXT,
  RAIN_BARREL_STATUS_ICON,
  RAIN_BARREL_STATUS_LABEL,
  RAIN_BARREL_STATUS_STYLES,
  rainBarrelFillPercent,
} from "./rain-barrel-display";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import type { SnapshotRainBarrel } from "./types";

export interface RainBarrelPanelProps {
  rainBarrels: SnapshotRainBarrel[];
  disabled?: boolean;
  onChanged?: () => Promise<void>;
}

interface RainBarrelCardProps {
  barrel: SnapshotRainBarrel;
  disabled: boolean;
  onChanged?: () => Promise<void>;
}

function RainBarrelCard({ barrel, disabled, onChanged }: RainBarrelCardProps) {
  const [addAmount, setAddAmount] = useState("5");
  const [drawAmount, setDrawAmount] = useState("5");
  const [catchmentInput, setCatchmentInput] = useState(String(barrel.catchmentAreaSqFt));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageIsError, setMessageIsError] = useState(false);

  const Icon = RAIN_BARREL_STATUS_ICON[barrel.status];
  const fillPercent = rainBarrelFillPercent(barrel.currentGallons, barrel.capacityGallons);

  async function handleAdd(): Promise<void> {
    const amount = Number(addAmount);
    if (busy || !Number.isFinite(amount) || amount <= 0) return;
    setBusy(true);
    setMessage(null);
    try {
      // Same addWater() the daily real-rainfall auto-fill uses — the 3D
      // water-level overlay and the fill gauge above both re-derive from
      // currentGallons on every refresh, so this shows up in both places
      // exactly like a draw already does, with no extra wiring needed.
      const result = await addRainBarrelWaterAction(barrel.id, amount);
      if (!result.ok) {
        setMessageIsError(true);
        setMessage(result.error ?? "Couldn't add water to that barrel.");
        return;
      }
      await onChanged?.();
      setMessageIsError(false);
      setMessage(`Added ${amount} gal to Barrel ${barrel.yardSlot}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleDraw(): Promise<void> {
    const amount = Number(drawAmount);
    if (busy || !Number.isFinite(amount) || amount <= 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await drawRainBarrelWaterAction(barrel.id, amount);
      if (!result.ok) {
        setMessageIsError(true);
        setMessage(result.error ?? "Couldn't draw water from that barrel.");
        return;
      }
      await onChanged?.();
      setMessageIsError(false);
      setMessage(`Logged ${amount} gal used from Barrel ${barrel.yardSlot}.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveCatchmentArea(): Promise<void> {
    const sqFt = Number(catchmentInput);
    if (busy || !Number.isFinite(sqFt) || sqFt <= 0) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await updateRainBarrelCatchmentAreaAction(barrel.id, sqFt);
      if (!result.ok) {
        setMessageIsError(true);
        setMessage(result.error ?? "Couldn't update catchment area.");
        return;
      }
      await onChanged?.();
      setMessageIsError(false);
      setMessage("Catchment area updated.");
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
        <p className="flex items-center gap-2 font-semibold" style={{ color: "var(--color-text)" }}>
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
          Rain Barrel {barrel.yardSlot}
        </p>
        <span
          className={`rounded-full border px-2 py-0.5 text-xs font-medium ${RAIN_BARREL_STATUS_STYLES[barrel.status]}`}
        >
          {RAIN_BARREL_STATUS_LABEL[barrel.status]}
        </span>
      </div>

      <div>
        <div
          className="h-3 w-full overflow-hidden rounded-full border"
          style={{ borderColor: "var(--color-border)", background: "var(--rainbarrel-empty-bg)" }}
          role="progressbar"
          aria-valuenow={fillPercent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={`Barrel ${barrel.yardSlot} fill level`}
        >
          <div
            className="h-full rounded-full transition-[width]"
            style={{ width: `${fillPercent}%`, background: "var(--rainbarrel-fill)" }}
          />
        </div>
        <p className="mt-1 text-xs" style={{ color: "var(--color-text-muted)" }}>
          {Math.round(barrel.currentGallons)} / {Math.round(barrel.capacityGallons)} gal ({fillPercent}%)
        </p>
      </div>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Catchment area (sq ft)
        <div className="flex gap-2">
          <input
            type="number"
            min="1"
            step="any"
            value={catchmentInput}
            onChange={(event) => setCatchmentInput(event.target.value)}
            disabled={disabled || busy}
            className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} w-28 rounded-md border bg-[var(--color-surface)] px-2`}
            style={{ borderColor: "var(--color-border)" }}
          />
          <button
            type="button"
            onClick={() => void handleSaveCatchmentArea()}
            disabled={disabled || busy || Number(catchmentInput) === barrel.catchmentAreaSqFt}
            className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} rounded-md border px-3 text-sm font-medium disabled:opacity-50`}
            style={{ borderColor: "var(--color-border)" }}
          >
            Save
          </button>
        </div>
      </label>
      <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
        {CATCHMENT_AREA_HELPER_TEXT}
      </p>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Add water manually (gal)
        <div className="flex gap-2">
          <input
            type="number"
            min="0.1"
            step="any"
            value={addAmount}
            onChange={(event) => setAddAmount(event.target.value)}
            disabled={disabled || busy}
            className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} w-28 rounded-md border bg-[var(--color-surface)] px-2`}
            style={{ borderColor: "var(--color-border)" }}
          />
          <button
            type="button"
            onClick={() => void handleAdd()}
            disabled={disabled || busy}
            className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} rounded-md border px-3 text-sm font-medium disabled:opacity-50`}
            style={{ borderColor: "var(--color-border)" }}
          >
            Add
          </button>
        </div>
      </label>

      <label className="flex flex-col gap-1 text-sm font-medium">
        Log water used (gal)
        <div className="flex gap-2">
          <input
            type="number"
            min="0.1"
            step="any"
            value={drawAmount}
            onChange={(event) => setDrawAmount(event.target.value)}
            disabled={disabled || busy}
            className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} w-28 rounded-md border bg-[var(--color-surface)] px-2`}
            style={{ borderColor: "var(--color-border)" }}
          />
          <button
            type="button"
            onClick={() => void handleDraw()}
            disabled={disabled || busy || barrel.currentGallons <= 0}
            className={`${MIN_TOUCH_TARGET} ${FOCUS_RING} rounded-md bg-[var(--color-cta-bg)] px-3 text-sm font-semibold text-[var(--color-cta-text)] disabled:opacity-50`}
          >
            Draw
          </button>
        </div>
      </label>

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

export function RainBarrelPanel({ rainBarrels, disabled = false, onChanged }: RainBarrelPanelProps) {
  if (rainBarrels.length === 0) {
    return null;
  }

  return (
    <section aria-label="Rain barrels" className="flex flex-col gap-2 rounded-xl border p-3 sm:p-4" style={{ borderColor: "var(--color-border)" }}>
      <h2 className="text-sm font-semibold" style={{ color: "var(--color-text)" }}>
        Rain barrels
      </h2>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rainBarrels.map((barrel) => (
          <RainBarrelCard key={barrel.id} barrel={barrel} disabled={disabled} onChanged={onChanged} />
        ))}
      </ul>
    </section>
  );
}

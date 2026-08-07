"use client";

import type { GrowthHabit, PollinationDependency } from "@prisma/client";
import { useDraggable } from "@dnd-kit/core";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createCustomSpeciesProfileAction,
  createInventoryPlantAction,
  deleteInventoryPlantAction,
  getFallbackSpeciesProfileAction,
  listSpeciesProfilesAction,
  updateInventoryPlantAction,
  uploadPlantImageAction,
  type ActionResult,
  type CreatePlantResult,
} from "@/app/actions";
import type {
  InventoryPlant,
  InventorySnapshot,
  PlantInput,
} from "@/domain/plant-catalog/inventory-service";
import { guessSpeciesKey, type CustomSpeciesInput, type SpeciesProfileSummary } from "@/domain/growth/species-catalog";
import { SEED_UNIT_LABELS, SEED_UNIT_OPTIONS, type SeedUnit } from "@/domain/plant-catalog/seed-units";

type Props = {
  inventory: InventorySnapshot;
  disabled: boolean;
  onChanged: () => Promise<void>;
  // When true, skips the card chrome (border/background/shadow) so this can
  // be nested inside GardenTopTabs' "Household inventory" tab panel, which
  // already provides it, instead of stacking card-in-card.
  bare?: boolean;
};

const INPUT =
  "min-h-11 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-clay)]";

const GROWTH_HABITS: readonly GrowthHabit[] = ["UPRIGHT_BUSH", "VINING", "ROSETTE_LEAFY", "ROOT_CROP"];
const POLLINATION_DEPENDENCIES: readonly PollinationDependency[] = ["SELF", "WIND", "INSECT"];

function SeedSlot({
  plant,
  disabled,
  isOpen,
  onToggle,
  onClose,
  onEdit,
  onDelete,
  onImage,
}: {
  plant: InventoryPlant;
  disabled: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onImage: (file: File) => void;
}) {
  const canDrag = !disabled && plant.seedQuantity > 0;
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `plant:${plant.id}`,
    data: { plant },
    disabled: !canDrag,
  });
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent): void {
      if (slotRef.current && !slotRef.current.contains(event.target as Node)) {
        onClose();
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  return (
    <div ref={slotRef} className="group relative">
      <button
        ref={setNodeRef}
        type="button"
        disabled={disabled}
        onClick={onToggle}
        aria-label={`${plant.commonName}, ${plant.seedQuantity} seeds. ${
          canDrag ? "Drag to plant, click for details." : "Click for details."
        }`}
        aria-expanded={isOpen}
        style={{
          borderColor: isOpen ? "var(--color-accent)" : "var(--color-border)",
          background: "var(--color-surface)",
          opacity: isDragging ? 0.35 : plant.seedQuantity <= 0 ? 0.55 : undefined,
          boxShadow: "inset 0 1px 3px rgba(0,0,0,0.18), inset 0 0 0 1px rgba(255,255,255,0.04)",
        }}
        className={`relative flex aspect-square w-full touch-none items-center justify-center overflow-hidden rounded-lg border-2 transition-[transform,box-shadow] duration-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-40 ${
          canDrag ? "cursor-grab hover:-translate-y-0.5" : "cursor-pointer"
        }`}
        {...attributes}
        {...listeners}
        aria-disabled={disabled}
      >
        {plant.imageUrl ? (
          <Image
            src={`${plant.imageUrl}?v=${encodeURIComponent(plant.seedQuantity)}`}
            alt=""
            fill
            unoptimized
            className="object-cover"
          />
        ) : (
          <span className="text-2xl" aria-hidden="true">
            🌱
          </span>
        )}
        {plant.seedQuantity > 0 && (
          <span
            className="absolute bottom-0 right-0 rounded-tl px-1 py-0.5 text-[10px] font-bold leading-tight text-white"
            style={{ background: "rgba(0,0,0,0.72)" }}
          >
            {plant.seedQuantity}
          </span>
        )}
      </button>

      {!isOpen && (
        <div
          role="tooltip"
          className="pointer-events-none absolute left-1/2 top-full z-10 mt-2 w-max max-w-48 -translate-x-1/2 rounded-md border px-2 py-1 text-xs opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}
        >
          <strong className="block">{plant.commonName}</strong>
          {plant.speciesProfileName && (
            <span className="block italic" style={{ color: "var(--color-text-muted)" }}>
              {plant.speciesProfileName}
            </span>
          )}
          <span className="block">
            {plant.seedUnit === "seed"
              ? `${plant.seedQuantity} seeds`
              : `≈${plant.unitQuantity} ${plant.seedUnit}s (${plant.seedQuantity} seeds)`}
          </span>
        </div>
      )}

      {isOpen && (
        <div
          className="absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-lg border p-3 text-sm shadow-lg"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}
        >
          <p className="truncate font-semibold">{plant.commonName}</p>
          {plant.speciesProfileName && (
            <p className="truncate text-xs italic" style={{ color: "var(--color-text-muted)" }}>
              {plant.speciesProfileName}
            </p>
          )}
          <p className="mt-1">
            {plant.seedUnit === "seed" ? (
              <>
                <strong>{plant.seedQuantity}</strong> seeds
              </>
            ) : (
              <>
                ≈<strong>{plant.unitQuantity}</strong> {plant.seedUnit}s ({plant.seedQuantity} seeds)
              </>
            )}
          </p>
          <div className="mt-3 flex flex-wrap gap-2 border-t pt-2 text-xs" style={{ borderColor: "var(--color-border)" }}>
            <button
              type="button"
              onClick={() => {
                onEdit();
                onClose();
              }}
              disabled={disabled}
              className="min-h-9 rounded-md border px-2 font-semibold hover:bg-[var(--color-surface)]"
              style={{ borderColor: "var(--color-border)" }}
            >
              Edit
            </button>
            <label
              className="flex min-h-9 cursor-pointer items-center rounded-md border px-2 font-semibold hover:bg-[var(--color-surface)]"
              style={{ borderColor: "var(--color-border)" }}
            >
              Image
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                className="sr-only"
                disabled={disabled}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onImage(file);
                  event.target.value = "";
                  onClose();
                }}
              />
            </label>
            <button
              type="button"
              onClick={() => {
                onDelete();
                onClose();
              }}
              disabled={disabled}
              className="min-h-9 rounded-md border px-2 font-semibold hover:bg-[var(--color-surface)]"
              style={{ borderColor: "var(--color-border)", color: "var(--color-danger-text)" }}
            >
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// Backs the "create new species" form's numeric defaults so a non-expert
// edits sensible starting values rather than blank/zero fields — owns its
// own local field state (CustomSpeciesFields) so that state is only ever
// declared once defaults have actually loaded, avoiding a conditional hook
// count in a single component (rules-of-hooks).
function CustomSpeciesForm({
  onCreated,
  onCancel,
}: {
  onCreated: (profile: SpeciesProfileSummary) => void;
  onCancel: () => void;
}) {
  const [defaults, setDefaults] = useState<CustomSpeciesInput | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getFallbackSpeciesProfileAction().then((fallback) => {
      if (cancelled) return;
      setDefaults({
        displayName: "",
        growthHabit: fallback.growthHabit,
        baseTempC: fallback.baseTempC,
        gddToGerminate: fallback.gddToGerminate,
        gddToVegetative: fallback.gddToVegetative,
        gddToFlowering: fallback.gddToFlowering,
        gddToFruiting: fallback.gddToFruiting,
        gddToMaturity: fallback.gddToMaturity,
        heatStressThresholdC: fallback.heatStressThresholdC,
        coldStressThresholdC: fallback.coldStressThresholdC,
        matureHeightCm: fallback.matureHeightCm,
        canopyWidthCm: fallback.canopyWidthCm,
        primaryColor: fallback.primaryColor,
        droughtComfortFraction: fallback.droughtComfortFraction,
        lightNeedFraction: fallback.lightNeedFraction,
        pollinationDependency: fallback.pollinationDependency,
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!defaults) {
    return (
      <p className="p-2 text-xs" style={{ color: "var(--color-text-muted)" }}>
        Loading defaults…
      </p>
    );
  }
  return <CustomSpeciesFields defaults={defaults} onCreated={onCreated} onCancel={onCancel} />;
}

function CustomSpeciesFields({
  defaults,
  onCreated,
  onCancel,
}: {
  defaults: CustomSpeciesInput;
  onCreated: (profile: SpeciesProfileSummary) => void;
  onCancel: () => void;
}) {
  const [input, setInput] = useState<CustomSpeciesInput>(defaults);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function setField<K extends keyof CustomSpeciesInput>(key: K, value: CustomSpeciesInput[K]): void {
    setInput((current) => ({ ...current, [key]: value }));
  }

  return (
    <form
      className="grid max-h-72 gap-2 overflow-y-auto rounded-lg border p-3 text-xs sm:grid-cols-2"
      style={{ borderColor: "var(--color-border)" }}
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(null);
        const result = await createCustomSpeciesProfileAction(input);
        setBusy(false);
        if (!result.ok || !result.profile) {
          setError(result.error ?? "Couldn't create species.");
          return;
        }
        onCreated(result.profile);
      }}
    >
      <label className="text-xs sm:col-span-2">
        <span className="mb-1 block font-medium">Display name</span>
        <input className={INPUT} value={input.displayName} onChange={(event) => setField("displayName", event.target.value)} required autoFocus />
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">Growth habit</span>
        <select className={INPUT} value={input.growthHabit} onChange={(event) => setField("growthHabit", event.target.value as GrowthHabit)}>
          {GROWTH_HABITS.map((habit) => (
            <option key={habit} value={habit}>{habit.replace(/_/g, " ")}</option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">Primary color</span>
        <input className={`${INPUT} h-11 p-1`} type="color" value={input.primaryColor} onChange={(event) => setField("primaryColor", event.target.value)} />
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">Pollination</span>
        <select
          className={INPUT}
          value={input.pollinationDependency ?? "SELF"}
          onChange={(event) => setField("pollinationDependency", event.target.value as PollinationDependency)}
        >
          {POLLINATION_DEPENDENCIES.map((dep) => (
            <option key={dep} value={dep}>{dep}</option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">Base temp (°C)</span>
        <input className={INPUT} type="number" step="any" value={input.baseTempC} onChange={(event) => setField("baseTempC", Number(event.target.value))} required />
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">Heat stress (°C)</span>
        <input className={INPUT} type="number" step="any" value={input.heatStressThresholdC} onChange={(event) => setField("heatStressThresholdC", Number(event.target.value))} required />
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">Cold stress (°C)</span>
        <input className={INPUT} type="number" step="any" value={input.coldStressThresholdC} onChange={(event) => setField("coldStressThresholdC", Number(event.target.value))} required />
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">Mature height (cm)</span>
        <input className={INPUT} type="number" step="any" value={input.matureHeightCm} onChange={(event) => setField("matureHeightCm", Number(event.target.value))} required />
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">Canopy width (cm)</span>
        <input className={INPUT} type="number" step="any" value={input.canopyWidthCm} onChange={(event) => setField("canopyWidthCm", Number(event.target.value))} required />
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">GDD to germinate</span>
        <input className={INPUT} type="number" step="any" value={input.gddToGerminate} onChange={(event) => setField("gddToGerminate", Number(event.target.value))} required />
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">GDD to vegetative</span>
        <input className={INPUT} type="number" step="any" value={input.gddToVegetative} onChange={(event) => setField("gddToVegetative", Number(event.target.value))} required />
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">GDD to flowering</span>
        <input className={INPUT} type="number" step="any" value={input.gddToFlowering} onChange={(event) => setField("gddToFlowering", Number(event.target.value))} required />
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">GDD to fruiting</span>
        <input className={INPUT} type="number" step="any" value={input.gddToFruiting} onChange={(event) => setField("gddToFruiting", Number(event.target.value))} required />
      </label>
      <label className="text-xs">
        <span className="mb-1 block font-medium">GDD to maturity</span>
        <input className={INPUT} type="number" step="any" value={input.gddToMaturity} onChange={(event) => setField("gddToMaturity", Number(event.target.value))} required />
      </label>
      {error && (
        <p className="text-xs sm:col-span-2" style={{ color: "var(--color-danger-text)" }}>{error}</p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={busy} className="min-h-9 rounded-md bg-[var(--color-cta-bg)] px-3 font-semibold text-[var(--color-cta-text)] disabled:opacity-50">
          Create species
        </button>
        <button type="button" onClick={onCancel} disabled={busy} className="min-h-9 rounded-md border px-3" style={{ borderColor: "var(--color-border)" }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

// Searchable species picker backing the Add Plant form's "Species" field —
// this is the fix for species (free text) having zero effect on
// simulation: growth is driven by Plant.speciesProfileId, so the picker
// must resolve to a real SpeciesProfile row, not accept arbitrary text.
// Follows SeedSlot's own outside-click/Escape popover idiom above.
function SpeciesPicker({
  options,
  speciesProfileId,
  speciesDisplayName,
  onSelect,
  onCreated,
  disabled,
}: {
  options: readonly SpeciesProfileSummary[];
  speciesProfileId: string | null;
  speciesDisplayName: string | null;
  onSelect: (profile: SpeciesProfileSummary) => void;
  onCreated: (profile: SpeciesProfileSummary) => void;
  disabled: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [query, setQuery] = useState("");
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  function close(): void {
    setIsOpen(false);
    setIsCreating(false);
  }

  useEffect(() => {
    if (!isOpen) return;
    function handlePointerDown(event: MouseEvent): void {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        close();
      }
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") close();
    }
    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  const normalized = query.trim().toLocaleLowerCase();
  const filtered = useMemo(
    () => options.filter((entry) => entry.displayName.toLocaleLowerCase().includes(normalized)),
    [options, normalized],
  );

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        aria-expanded={isOpen}
        className={`${INPUT} text-left`}
      >
        {speciesDisplayName ?? "Choose a species…"}
      </button>
      {isOpen && (
        <div
          className="absolute z-30 mt-1 w-72 max-w-[85vw] rounded-lg border p-2 shadow-lg"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}
        >
          {isCreating ? (
            <CustomSpeciesForm
              onCreated={(profile) => {
                onCreated(profile);
                onSelect(profile);
                close();
              }}
              onCancel={() => setIsCreating(false)}
            />
          ) : (
            <>
              <input
                type="search"
                className={`${INPUT} mb-2`}
                placeholder="Search species…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                autoFocus
              />
              <ul className="max-h-56 overflow-y-auto">
                {filtered.map((entry) => (
                  <li key={entry.id}>
                    <button
                      type="button"
                      onClick={() => {
                        onSelect(entry);
                        close();
                      }}
                      className="w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-[var(--color-surface)]"
                      style={{ fontWeight: entry.id === speciesProfileId ? 600 : 400 }}
                    >
                      {entry.displayName}
                    </button>
                  </li>
                ))}
                {!filtered.length && (
                  <li className="px-2 py-1.5 text-sm" style={{ color: "var(--color-text-muted)" }}>
                    No species match.
                  </li>
                )}
              </ul>
              <button
                type="button"
                onClick={() => setIsCreating(true)}
                className="mt-1 w-full rounded-md border px-2 py-1.5 text-left text-sm font-semibold hover:bg-[var(--color-surface)]"
                style={{ borderColor: "var(--color-border)" }}
              >
                + Create new species
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function PlantForm({
  plant,
  speciesOptions,
  onSpeciesCreated,
  onSave,
  onCancel,
  disabled,
}: {
  plant: InventoryPlant | null;
  speciesOptions: readonly SpeciesProfileSummary[];
  onSpeciesCreated: (profile: SpeciesProfileSummary) => void;
  onSave: (input: PlantInput, imageFile: File | null) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [name, setName] = useState(plant?.commonName ?? "");
  const [speciesProfileId, setSpeciesProfileId] = useState<string | null>(plant?.speciesProfileId ?? null);
  const [speciesDisplayName, setSpeciesDisplayName] = useState<string | null>(plant?.speciesProfileName ?? null);
  const [unit, setUnit] = useState<SeedUnit>((plant?.seedUnit as SeedUnit) ?? "seed");
  const [seedQuantityInput, setSeedQuantityInput] = useState(String(plant?.seedQuantity ?? 0));
  const [seedsPerUnitInput, setSeedsPerUnitInput] = useState(String(plant?.seedsPerUnit ?? 1));
  const [unitQuantityInput, setUnitQuantityInput] = useState(String(plant?.unitQuantity ?? 0));
  const [notes, setNotes] = useState(plant?.notes ?? "");
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!imageFile) {
      setImagePreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(imageFile);
    setImagePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [imageFile]);

  return (
    <form
      className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      onSubmit={(event) => {
        event.preventDefault();
        const seedsPerUnit = unit === "seed" ? 1 : Number(seedsPerUnitInput);
        const seedQuantity = unit === "seed" ? Number(seedQuantityInput) : Number(unitQuantityInput) * seedsPerUnit;
        onSave(
          {
            commonName: name,
            speciesProfileId,
            notes,
            seedQuantity,
            seedUnit: unit,
            seedsPerUnit,
            isCompanionPlanting: plant?.isCompanionPlanting ?? false,
            waterNeed: plant?.waterNeed,
            lightNeed: plant?.lightNeed,
          },
          imageFile,
        );
      }}
    >
      <label className="text-sm">
        <span className="mb-1 block font-medium">Plant name</span>
        <input
          className={INPUT}
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            // UX nicety only, never authoritative: pre-selects a catalog
            // match once the user finishes typing a new plant's name and
            // hasn't picked a species yet — still fully overridable via the
            // picker below, never silently submitted.
            if (speciesProfileId || !name.trim()) return;
            const guessedKey = guessSpeciesKey(name);
            const match = speciesOptions.find((option) => option.key === guessedKey);
            if (match) {
              setSpeciesProfileId(match.id);
              setSpeciesDisplayName(match.displayName);
            }
          }}
          required
        />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Species</span>
        <SpeciesPicker
          options={speciesOptions}
          speciesProfileId={speciesProfileId}
          speciesDisplayName={speciesDisplayName}
          onSelect={(profile) => {
            setSpeciesProfileId(profile.id);
            setSpeciesDisplayName(profile.displayName);
          }}
          onCreated={onSpeciesCreated}
          disabled={disabled}
        />
      </label>
      <div className="text-sm sm:col-span-2">
        <span className="mb-1 block font-medium">Photo (optional)</span>
        <div className="flex items-center gap-3">
          {(imagePreviewUrl ?? plant?.imageUrl) && (
            <Image
              src={imagePreviewUrl ?? plant!.imageUrl!}
              alt=""
              width={48}
              height={48}
              unoptimized={Boolean(imagePreviewUrl)}
              className="h-12 w-12 rounded-md object-cover"
            />
          )}
          <label
            className="flex min-h-11 cursor-pointer items-center rounded-md border px-3 text-sm font-semibold hover:bg-[var(--color-surface-raised)]"
            style={{ borderColor: "var(--color-border)" }}
          >
            {imageFile ? "Change photo" : "Choose photo"}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              className="sr-only"
              disabled={disabled}
              onChange={(event) => setImageFile(event.target.files?.[0] ?? null)}
            />
          </label>
          {imageFile && (
            <button
              type="button"
              onClick={() => setImageFile(null)}
              disabled={disabled}
              className="text-xs underline"
              style={{ color: "var(--color-text-muted)" }}
            >
              Remove
            </button>
          )}
        </div>
      </div>
      {unit === "seed" ? (
        <label className="text-sm">
          <span className="mb-1 block font-medium">Quantity (seeds)</span>
          <input className={INPUT} type="number" min="0" step="any" value={seedQuantityInput} onChange={(event) => setSeedQuantityInput(event.target.value)} required />
        </label>
      ) : (
        <label className="text-sm">
          <span className="mb-1 block font-medium">Quantity ({unit}s)</span>
          <input className={INPUT} type="number" min="0" step="any" value={unitQuantityInput} onChange={(event) => setUnitQuantityInput(event.target.value)} required />
        </label>
      )}
      <label className="text-sm">
        <span className="mb-1 block font-medium">Unit</span>
        <select className={INPUT} value={unit} onChange={(event) => setUnit(event.target.value as SeedUnit)}>
          {SEED_UNIT_OPTIONS.map((option) => (
            <option key={option} value={option}>{SEED_UNIT_LABELS[option]}</option>
          ))}
        </select>
      </label>
      {unit !== "seed" && (
        <label className="text-sm">
          <span className="mb-1 block font-medium">Seeds per {unit}</span>
          <input className={INPUT} type="number" min="0.01" step="any" value={seedsPerUnitInput} onChange={(event) => setSeedsPerUnitInput(event.target.value)} required />
        </label>
      )}
      <label className="text-sm sm:col-span-2">
        <span className="mb-1 block font-medium">Notes</span>
        <textarea className={`${INPUT} min-h-20 py-2`} value={notes} onChange={(event) => setNotes(event.target.value)} />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <button type="submit" disabled={disabled} className="min-h-11 rounded-md bg-[var(--color-cta-bg)] px-4 font-semibold text-[var(--color-cta-text)] disabled:opacity-50">
          {plant ? "Save changes" : "Add plant"}
        </button>
        <button type="button" onClick={onCancel} disabled={disabled} className="min-h-11 rounded-md border px-4" style={{ borderColor: "var(--color-border)" }}>
          Cancel
        </button>
      </div>
    </form>
  );
}

export function InventoryPanel({ inventory, disabled, onChanged, bare = false }: Props) {
  const [tab, setTab] = useState<"seeds" | "yield">("seeds");
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<InventoryPlant | null | "new">(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [openSlotId, setOpenSlotId] = useState<string | null>(null);
  const [speciesOptions, setSpeciesOptions] = useState<SpeciesProfileSummary[]>([]);
  const isEditing = editing !== null;

  // Fetched once per edit session, not on every keystroke and not bundled
  // into the existing snapshot polling — the species catalog changes
  // rarely, unlike inventory quantities.
  useEffect(() => {
    if (!isEditing) return;
    let cancelled = false;
    void listSpeciesProfilesAction().then((list) => {
      if (!cancelled) setSpeciesOptions(list);
    });
    return () => {
      cancelled = true;
    };
  }, [isEditing]);

  const normalized = query.trim().toLocaleLowerCase();
  const seeds = useMemo(
    () =>
      inventory.seeds.filter((plant) =>
        [plant.commonName, plant.speciesProfileName, plant.notes]
          .filter(Boolean)
          .some((value) => value!.toLocaleLowerCase().includes(normalized)),
      ),
    [inventory.seeds, normalized],
  );
  const yields = useMemo(
    () =>
      inventory.yields.filter((entry) =>
        [entry.plantName, entry.notes, entry.unit].filter(Boolean).some((value) =>
          value!.toLocaleLowerCase().includes(normalized),
        ),
      ),
    [inventory.yields, normalized],
  );
  const totals = useMemo(() => {
    const grouped = new Map<string, { plantName: string; unit: string; amount: number; count: number }>();
    for (const entry of yields) {
      const key = `${entry.plantId}:${entry.unit.toLocaleLowerCase()}`;
      const total = grouped.get(key) ?? { plantName: entry.plantName, unit: entry.unit, amount: 0, count: 0 };
      total.amount += entry.amount;
      total.count += 1;
      grouped.set(key, total);
    }
    return [...grouped.values()];
  }, [yields]);

  async function mutate(operation: () => Promise<ActionResult>, success: string): Promise<void> {
    setBusy(true);
    setMessage(null);
    try {
      const result = await operation();
      if (!result.ok) {
        setMessage(result.error ?? "Something went wrong.");
        return;
      }
      await onChanged();
      setEditing(null);
      setMessage(success);
    } catch {
      setMessage("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const Wrapper = bare ? "div" : "section";

  return (
    <Wrapper
      className={bare ? undefined : "rounded-xl border p-4 sm:p-5"}
      style={
        bare
          ? undefined
          : { borderColor: "var(--color-border)", background: "var(--color-surface-raised)", boxShadow: "var(--shadow-card)" }
      }
      aria-labelledby="inventory-heading"
    >
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          {!bare && (
            <p className="text-xs font-semibold uppercase tracking-[0.14em]" style={{ color: "var(--color-clay-strong)" }}>Household inventory</p>
          )}
          <h2 id="inventory-heading" className="text-2xl" style={{ fontFamily: "var(--font-display)" }}>Seeds & yield</h2>
        </div>
        <button type="button" onClick={() => setEditing("new")} className="min-h-11 rounded-md bg-[var(--color-cta-bg)] px-4 text-sm font-semibold text-[var(--color-cta-text)]">
          Add plant
        </button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Inventory category">
        {(["seeds", "yield"] as const).map((value) => (
          <button key={value} type="button" role="tab" aria-selected={tab === value} onClick={() => setTab(value)} className="min-h-11 rounded-md border px-4 text-sm font-semibold" style={{ borderColor: tab === value ? "var(--color-accent)" : "var(--color-border)", background: tab === value ? "var(--color-surface)" : "transparent" }}>
            {value === "seeds" ? `Seeds (${inventory.seeds.length})` : `Yield (${inventory.yields.length})`}
          </button>
        ))}
        <label className="min-w-52 flex-1 sm:ml-auto sm:max-w-sm">
          <span className="sr-only">Search inventory</span>
          <input type="search" className={INPUT} placeholder={`Search ${tab}…`} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
      </div>
      <div role="status" aria-live="polite" className="mb-3 text-sm" style={{ color: message?.includes("wrong") || message?.includes("server") ? "var(--color-danger-text)" : "var(--color-text-muted)" }}>{message}</div>
      {editing && (
        <div className="mb-4">
          <PlantForm
            key={editing === "new" ? "new" : editing.id}
            plant={editing === "new" ? null : editing}
            speciesOptions={speciesOptions}
            onSpeciesCreated={(profile) =>
              setSpeciesOptions((current) =>
                [...current, profile].sort((a, b) => a.displayName.localeCompare(b.displayName)),
              )
            }
            disabled={busy}
            onCancel={() => setEditing(null)}
            onSave={(input, imageFile) => {
              const isNew = editing === "new";
              const editingId = isNew ? null : editing.id;
              let photoWarning: string | null = null;
              void mutate(async (): Promise<ActionResult> => {
                const result: CreatePlantResult = isNew
                  ? await createInventoryPlantAction(input)
                  : await updateInventoryPlantAction(editingId!, input);
                if (!result.ok) return result;
                const plantId = isNew ? result.plantId : editingId;
                // The plant record is already saved at this point — never
                // fail the whole operation over a photo upload hiccup, or
                // the form stays open and resubmitting would create a
                // duplicate plant (createInventoryPlantAction has no
                // upsert semantics).
                if (imageFile && plantId) {
                  const formData = new FormData();
                  formData.set("plantId", plantId);
                  formData.set("image", imageFile);
                  const imageResult = await uploadPlantImageAction(formData);
                  if (!imageResult.ok) {
                    photoWarning = imageResult.error ?? "Photo upload failed.";
                  }
                }
                return { ok: true };
              }, isNew ? "Plant added." : "Plant updated.").then(() => {
                if (photoWarning) setMessage((current) => `${current} Photo not saved: ${photoWarning}`);
              });
            }}
          />
        </div>
      )}
      {tab === "seeds" ? (
        seeds.length ? (
          <div className="max-h-[28rem] overflow-y-auto pr-1">
            <div className="grid grid-cols-[repeat(auto-fill,minmax(6rem,6rem))] gap-2.5">
              {seeds.map((plant) => (
                <SeedSlot
                  key={plant.id}
                  plant={plant}
                  disabled={disabled || busy}
                  isOpen={openSlotId === plant.id}
                  onToggle={() => setOpenSlotId((current) => (current === plant.id ? null : plant.id))}
                  onClose={() => setOpenSlotId((current) => (current === plant.id ? null : current))}
                  onEdit={() => setEditing(plant)}
                  onDelete={() => {
                    if (window.confirm(`Delete ${plant.commonName}? Historical plants will be archived.`)) {
                      void mutate(() => deleteInventoryPlantAction(plant.id), "Plant removed.");
                    }
                  }}
                  onImage={(file) => {
                    const formData = new FormData();
                    formData.set("plantId", plant.id);
                    formData.set("image", file);
                    void mutate(() => uploadPlantImageAction(formData), "Image updated.");
                  }}
                />
              ))}
            </div>
          </div>
        ) : (
          <p className="py-6 text-sm" style={{ color: "var(--color-text-muted)" }}>No seeds match this search.</p>
        )
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <div className="space-y-2">
            <h3 className="font-semibold">Totals by plant and unit</h3>
            {totals.map((total) => (
              <div key={`${total.plantName}:${total.unit}`} className="rounded-lg bg-[var(--color-surface)] p-3 text-sm">
                <strong>{total.plantName}</strong>
                <p>{total.amount} {total.unit} across {total.count} harvest{total.count === 1 ? "" : "s"}</p>
              </div>
            ))}
            {!totals.length && <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>No harvests recorded yet.</p>}
          </div>
          <div className="space-y-2">
            <h3 className="font-semibold">Harvests</h3>
            <ol className="space-y-2">
              {yields.map((entry) => (
                <li key={entry.id} className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--color-border)" }}>
                  <div className="flex justify-between gap-3"><strong>{entry.plantName}</strong><span>{entry.amount} {entry.unit}</span></div>
                  <p style={{ color: "var(--color-text-muted)" }}>{new Date(entry.harvestedAt).toLocaleDateString(undefined, { timeZone: "UTC" })} · {entry.bedName}, column {entry.column}, row {entry.row}</p>
                  {entry.notes && <p className="mt-1">{entry.notes}</p>}
                </li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </Wrapper>
  );
}

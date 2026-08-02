"use client";

import { useDraggable } from "@dnd-kit/core";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  createInventoryPlantAction,
  deleteInventoryPlantAction,
  updateInventoryPlantAction,
  uploadPlantImageAction,
  type ActionResult,
} from "@/app/actions";
import type {
  InventoryPlant,
  InventorySnapshot,
  PlantInput,
} from "@/domain/plant-catalog/inventory-service";

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
        aria-label={`${plant.commonName}, ${plant.seedQuantity} ${plant.seedUnit}. ${
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
          <span className="text-base" aria-hidden="true">
            🌱
          </span>
        )}
        {plant.seedQuantity > 0 && (
          <span
            className="absolute bottom-0 right-0 rounded-tl px-0.5 text-[8px] font-bold leading-tight text-white"
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
          {plant.species && (
            <span className="block italic" style={{ color: "var(--color-text-muted)" }}>
              {plant.species}
            </span>
          )}
          <span className="block">
            {plant.seedQuantity} {plant.seedUnit}
          </span>
        </div>
      )}

      {isOpen && (
        <div
          className="absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-lg border p-3 text-sm shadow-lg"
          style={{ borderColor: "var(--color-border)", background: "var(--color-surface-raised)" }}
        >
          <p className="truncate font-semibold">{plant.commonName}</p>
          {plant.species && (
            <p className="truncate text-xs italic" style={{ color: "var(--color-text-muted)" }}>
              {plant.species}
            </p>
          )}
          <p className="mt-1">
            <strong>{plant.seedQuantity}</strong> {plant.seedUnit}
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

function PlantForm({
  plant,
  onSave,
  onCancel,
  disabled,
}: {
  plant: InventoryPlant | null;
  onSave: (input: PlantInput) => void;
  onCancel: () => void;
  disabled: boolean;
}) {
  const [name, setName] = useState(plant?.commonName ?? "");
  const [species, setSpecies] = useState(plant?.species ?? "");
  const [quantity, setQuantity] = useState(String(plant?.seedQuantity ?? 0));
  const [unit, setUnit] = useState(plant?.seedUnit ?? "seed");
  const [notes, setNotes] = useState(plant?.notes ?? "");

  return (
    <form
      className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"
      style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}
      onSubmit={(event) => {
        event.preventDefault();
        onSave({
          commonName: name,
          species,
          notes,
          seedQuantity: Number(quantity),
          seedUnit: unit,
          isCompanionPlanting: plant?.isCompanionPlanting ?? false,
          waterNeed: plant?.waterNeed,
          lightNeed: plant?.lightNeed,
        });
      }}
    >
      <label className="text-sm">
        <span className="mb-1 block font-medium">Plant name</span>
        <input className={INPUT} value={name} onChange={(event) => setName(event.target.value)} required />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Species</span>
        <input className={INPUT} value={species} onChange={(event) => setSpecies(event.target.value)} />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Quantity</span>
        <input className={INPUT} type="number" min="0" step="any" value={quantity} onChange={(event) => setQuantity(event.target.value)} required />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Unit</span>
        <input className={INPUT} value={unit} onChange={(event) => setUnit(event.target.value)} placeholder="seed, packet, start…" required />
      </label>
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
  const normalized = query.trim().toLocaleLowerCase();
  const seeds = useMemo(
    () =>
      inventory.seeds.filter((plant) =>
        [plant.commonName, plant.species, plant.notes]
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
            disabled={busy}
            onCancel={() => setEditing(null)}
            onSave={(input) =>
              void mutate(
                () => editing === "new" ? createInventoryPlantAction(input) : updateInventoryPlantAction(editing.id, input),
                editing === "new" ? "Plant added." : "Plant updated.",
              )
            }
          />
        </div>
      )}
      {tab === "seeds" ? (
        seeds.length ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(4rem,4rem))] gap-1.5">
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
          <ol className="space-y-2">
            {yields.map((entry) => (
              <li key={entry.id} className="rounded-lg border p-3 text-sm" style={{ borderColor: "var(--color-border)" }}>
                <div className="flex justify-between gap-3"><strong>{entry.plantName}</strong><span>{entry.amount} {entry.unit}</span></div>
                <p style={{ color: "var(--color-text-muted)" }}>{new Date(entry.harvestedAt).toLocaleDateString()} · {entry.bedName}, column {entry.column}, row {entry.row}</p>
                {entry.notes && <p className="mt-1">{entry.notes}</p>}
              </li>
            ))}
          </ol>
        </div>
      )}
    </Wrapper>
  );
}

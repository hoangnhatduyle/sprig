"use client";

// The Garden Journal (SPEC-JOURNAL-001) — a whole-garden, filterable,
// chronological feed of everything getGardenJournal merges (plantings,
// harvests, care actions, equipment, renovations, disease episodes, and
// freeform notes), plus a "Season recap" sub-view (SeasonRecapPanel) behind
// an inner tab switcher — same nested-tabs precedent as InventoryPanel's own
// seeds/yield split. Follows the bare-prop convention every other panel
// nested inside GardenTopTabs already uses.

import { useEffect, useRef, useState } from "react";
import { createJournalNoteAction, getGardenJournalAction, type ActionResult, type GardenJournalQuery } from "@/app/actions";
import type { GardenJournal } from "@/domain/journal/journal-service";
import { formatJournalTimestamp } from "./date-display";
import { CARE_ACTION_TYPE_ICON, JOURNAL_KIND_ICON, JOURNAL_KIND_LABEL, journalEntryPhrase } from "./journal-display";
import { SeasonRecapPanel } from "./SeasonRecapPanel";
import { FOCUS_RING, MIN_TOUCH_TARGET } from "./ui-constants";
import type { JournalEntry, JournalEntryKind, SnapshotBed } from "./types";

const KIND_OPTIONS: JournalEntryKind[] = [
  "LIFECYCLE",
  "HARVEST",
  "CARE_ACTION",
  "EQUIPMENT",
  "RENOVATION",
  "DISEASE",
  "NOTE",
];

const INNER_TABS = [
  { id: "feed", label: "Feed" },
  { id: "recap", label: "Season recap" },
] as const;
type InnerTab = (typeof INNER_TABS)[number]["id"];

export interface JournalPanelProps {
  beds: SnapshotBed[];
  initialJournal?: GardenJournal;
  bare?: boolean;
  disabled?: boolean;
  onChanged?: () => Promise<void>;
  getJournal?: (query: GardenJournalQuery) => Promise<GardenJournal>;
  createNote?: (formData: FormData) => Promise<ActionResult>;
}

function EntryIcon({ entry }: { entry: JournalEntry }) {
  const Icon = entry.kind === "CARE_ACTION" ? CARE_ACTION_TYPE_ICON[entry.actionType] : JOURNAL_KIND_ICON[entry.kind];
  return <Icon aria-hidden="true" className="h-4 w-4 shrink-0" style={{ color: "var(--color-accent-strong)" }} />;
}

function JournalEntryRow({ entry }: { entry: JournalEntry }) {
  return (
    <li className="flex items-start gap-3 border-b py-3 last:border-b-0" style={{ borderColor: "var(--color-border)" }}>
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border" style={{ borderColor: "var(--color-border)", background: "var(--color-surface)" }}>
        <EntryIcon entry={entry} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm" style={{ color: "var(--color-text)" }}>{journalEntryPhrase(entry)}</p>
        <p className="mt-0.5 text-xs" style={{ color: "var(--color-text-muted)" }}>
          {JOURNAL_KIND_LABEL[entry.kind]} · {formatJournalTimestamp(entry.occurredAt)}
        </p>
        {entry.kind === "NOTE" && entry.photoUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- user-uploaded photo served from our own API route, not an optimizable static asset.
          <img src={entry.photoUrl} alt="" className="mt-2 h-32 w-32 rounded-md border object-cover" style={{ borderColor: "var(--color-border)" }} />
        )}
      </div>
    </li>
  );
}

export function JournalPanel({
  beds,
  initialJournal,
  bare = false,
  disabled = false,
  onChanged,
  getJournal = getGardenJournalAction,
  createNote = createJournalNoteAction,
}: JournalPanelProps) {
  const [innerTab, setInnerTab] = useState<InnerTab>("feed");
  const [entries, setEntries] = useState<JournalEntry[]>(initialJournal?.entries ?? []);
  const [hasMore, setHasMore] = useState(initialJournal?.hasMore ?? false);
  const [bedFilter, setBedFilter] = useState("");
  const [kindFilter, setKindFilter] = useState<JournalEntryKind | "">("");
  const [showSystemEvents, setShowSystemEvents] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [noteBody, setNoteBody] = useState("");
  const [noteBedId, setNoteBedId] = useState("");
  const [noteFile, setNoteFile] = useState<File | null>(null);
  const [noteBusy, setNoteBusy] = useState(false);
  const [noteMessage, setNoteMessage] = useState<string | null>(null);

  async function loadJournal(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const journal = await getJournal({
        bedId: bedFilter || undefined,
        kinds: kindFilter ? [kindFilter] : undefined,
        includeSystemLifecycleEvents: showSystemEvents,
      });
      setEntries(journal.entries);
      setHasMore(journal.hasMore);
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setLoading(false);
    }
  }

  const isFirstRender = useRef(true);
  useEffect(() => {
    // The very first mount already has SSR-seeded data (initialJournal, via
    // page.tsx's getGardenJournal call) — skip the redundant fetch then and
    // only hit the server once a filter actually changes. A test/context
    // without initialJournal still gets its first fetch here.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      if (initialJournal) return;
    }
    void loadJournal();
    // loadJournal itself is recreated every render (it closes over state),
    // so it's deliberately excluded from the dependency array here rather
    // than wrapped in useCallback purely to satisfy exhaustive-deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bedFilter, kindFilter, showSystemEvents]);

  async function handleAddNote(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (noteBusy) return;
    setNoteBusy(true);
    setNoteMessage(null);
    try {
      const formData = new FormData();
      formData.set("body", noteBody);
      if (noteBedId) formData.set("bedId", noteBedId);
      if (noteFile) formData.set("image", noteFile);
      const result = await createNote(formData);
      if (!result.ok) {
        setNoteMessage(result.error ?? "Couldn't save that note.");
        return;
      }
      setNoteBody("");
      setNoteFile(null);
      setNoteMessage("Note added.");
      await loadJournal();
    } catch {
      setNoteMessage("Couldn't reach the server. Try again.");
    } finally {
      setNoteBusy(false);
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
      aria-labelledby="journal-heading"
    >
      {!bare && (
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.2em]" style={{ color: "var(--color-clay-strong)" }}>
          Recorded activity
        </p>
      )}
      <h2 id="journal-heading" className="mb-3 text-2xl" style={{ fontFamily: "var(--font-display)", color: "var(--color-text)" }}>
        Journal
      </h2>

      <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="Journal view">
        {INNER_TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={innerTab === id}
            onClick={() => setInnerTab(id)}
            className={`${MIN_TOUCH_TARGET} rounded-md border px-4 text-sm font-semibold ${FOCUS_RING}`}
            style={{
              borderColor: innerTab === id ? "var(--color-accent)" : "var(--color-border)",
              background: innerTab === id ? "var(--color-surface)" : "transparent",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {innerTab === "recap" ? (
        <SeasonRecapPanel
          beds={beds}
          disabled={disabled}
          onSeasonReset={async () => {
            await loadJournal();
            await onChanged?.();
          }}
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm font-medium">
              Bed
              <select
                value={bedFilter}
                onChange={(event) => setBedFilter(event.target.value)}
                disabled={disabled}
                className={`mt-1 block ${MIN_TOUCH_TARGET} rounded-md border bg-[var(--color-surface)] px-3 text-sm`}
                style={{ borderColor: "var(--color-border)" }}
              >
                <option value="">All beds</option>
                {beds.map((bed) => (
                  <option key={bed.id} value={bed.id}>{bed.name}</option>
                ))}
              </select>
            </label>
            <label className="text-sm font-medium">
              Kind
              <select
                value={kindFilter}
                onChange={(event) => setKindFilter(event.target.value as JournalEntryKind | "")}
                disabled={disabled}
                className={`mt-1 block ${MIN_TOUCH_TARGET} rounded-md border bg-[var(--color-surface)] px-3 text-sm`}
                style={{ borderColor: "var(--color-border)" }}
              >
                <option value="">All kinds</option>
                {KIND_OPTIONS.map((kind) => (
                  <option key={kind} value={kind}>{JOURNAL_KIND_LABEL[kind]}</option>
                ))}
              </select>
            </label>
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={showSystemEvents}
                onChange={(event) => setShowSystemEvents(event.target.checked)}
                disabled={disabled}
              />
              Show automatic growth updates
            </label>
          </div>

          <form onSubmit={(event) => void handleAddNote(event)} className="flex flex-col gap-2 rounded-lg border p-3" style={{ borderColor: "var(--color-border)" }}>
            <label className="text-sm font-medium" htmlFor="journal-note-body">Add a note</label>
            <textarea
              id="journal-note-body"
              value={noteBody}
              onChange={(event) => setNoteBody(event.target.value)}
              disabled={disabled || noteBusy}
              placeholder="Aphids showed up on the squash today…"
              rows={2}
              className="rounded-md border bg-[var(--color-surface)] px-3 py-2 text-sm"
              style={{ borderColor: "var(--color-border)" }}
            />
            <div className="flex flex-wrap items-center gap-3">
              <select
                value={noteBedId}
                onChange={(event) => setNoteBedId(event.target.value)}
                disabled={disabled || noteBusy}
                className={`${MIN_TOUCH_TARGET} rounded-md border bg-[var(--color-surface)] px-3 text-sm`}
                style={{ borderColor: "var(--color-border)" }}
              >
                <option value="">No specific bed</option>
                {beds.map((bed) => (
                  <option key={bed.id} value={bed.id}>{bed.name}</option>
                ))}
              </select>
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp,image/gif"
                onChange={(event) => setNoteFile(event.target.files?.[0] ?? null)}
                disabled={disabled || noteBusy}
                className="text-sm"
              />
              <button
                type="submit"
                disabled={disabled || noteBusy || (!noteBody.trim() && !noteFile)}
                className={`${MIN_TOUCH_TARGET} rounded-md bg-[var(--color-cta-bg)] px-4 text-sm font-semibold text-[var(--color-cta-text)] disabled:opacity-50 ${FOCUS_RING}`}
              >
                {noteBusy ? "Saving…" : "Save note"}
              </button>
            </div>
            {noteMessage && <p role="status" className="text-sm" style={{ color: "var(--color-text-muted)" }}>{noteMessage}</p>}
          </form>

          {error && <p role="alert" className="text-sm" style={{ color: "var(--color-danger-text)" }}>{error}</p>}

          {loading && entries.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Loading…</p>
          ) : entries.length === 0 ? (
            <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Nothing recorded yet.</p>
          ) : (
            <ul>
              {entries.map((entry) => (
                <JournalEntryRow key={`${entry.kind}:${entry.id}`} entry={entry} />
              ))}
            </ul>
          )}
          {hasMore && (
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>More entries exist — narrow your filters to see them.</p>
          )}
        </div>
      )}
    </Wrapper>
  );
}

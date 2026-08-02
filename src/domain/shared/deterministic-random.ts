// A small deterministic PRNG shared by the disease and pest domains, so
// infection rolls and (were they ever added) other stochastic draws are
// reproducible from (entity id/key, date) alone — the same determinism
// requirement procedural-weather-provider.ts already established for
// weather (architecture doc §14/§17): catch-up must produce identical
// results whether replayed incrementally or fast-forwarded in one batch,
// and §17's validation suite depends on "same seed+date always gives the
// same result." Deliberately a separate small file rather than importing
// procedural-weather-provider.ts's own private copy — that PRNG is scoped
// to weather generation, and duplicating ~10 lines here avoids coupling two
// otherwise-unrelated domains through a shared implementation detail.

// mulberry32 — fast, deterministic, not cryptographic (no need to be: only
// used so the exact same seed always produces the exact same draw).
export function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function random() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Combines a calendar date with an arbitrary string key (a cellPlantingId, a
// diseaseKey, ...) into one deterministic integer seed — the same
// date+salt always yields the same seed, different salts diverge.
export function dateKeySeed(date: Date, salt: string): number {
  const base = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) / 1000;
  let hash = base;
  for (let i = 0; i < salt.length; i += 1) {
    hash = (hash * 31 + salt.charCodeAt(i)) | 0;
  }
  return hash;
}

// One reproducible draw in [0, 1) for (date, salt) — the common case callers
// actually want, without wiring up mulberry32 themselves each time.
export function deterministicUnitDraw(date: Date, salt: string): number {
  return mulberry32(dateKeySeed(date, salt))();
}

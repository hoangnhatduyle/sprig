"use client";

import { useEffect, useState } from "react";

// True only once the client has painted at least once. React only checks
// that the *first* client render matches what the server sent — renders
// after that are ordinary updates, free to differ. So a component that
// needs a viewer-local value (e.g. the visitor's own timezone, unknowable
// server-side) can render an SSR-matching placeholder while `!hydrated`
// and swap to the real value the moment this flips true, without a
// hydration mismatch.
export function useHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  return hydrated;
}

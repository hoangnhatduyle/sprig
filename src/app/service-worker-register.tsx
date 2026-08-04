"use client";
import { useEffect } from "react";

// Registers the Sprig service worker (public/sw.js) so the app is
// installable as a PWA. Registering this URL also transparently upgrades any
// older worker that was previously controlling this origin.
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }).catch(() => {
      // Registration failures (e.g. unsupported browser, blocked SW) must not
      // break the app — installability is a progressive enhancement.
    });
  }, []);

  return null;
}

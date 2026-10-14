import { useCallback, useSyncExternalStore } from "react";

/**
 * In-app install support for the PWA.
 *
 * Browsers decide *when* (and whether) a web app is installable, and Chrome
 * announces it with a `beforeinstallprompt` event that can only be replayed
 * later from the exact same event object. That event can therefore arrive
 * before React mounts, so it is captured here at module scope and handed to
 * consumers through this hook.
 *
 * If no event has been captured, either the app is already installed, the
 * browser doesn't support the prompt (Safari/iOS), or the manifest hasn't
 * satisfied the browser's installability check — in which case there is nothing
 * to call and the UI falls back to manual instructions.
 *
 * @returns {{
 *   canInstall: boolean,
 *   isInstalled: boolean,
 *   isIos: boolean,
 *   promptInstall: () => Promise<"accepted" | "dismissed" | "unavailable">,
 * }}
 */

/** React's store subscriptions. */
const listeners = new Set();

/** The captured (single-use) prompt event, if the browser offered one. */
let deferredPrompt = null;

/** Set by `appinstalled`; `isStandalone()` covers fresh loads. */
let installedViaEvent = false;

/**
 * The last snapshot handed to React. `useSyncExternalStore` compares by
 * reference, so it is rebuilt only when a value actually changes.
 */
let cachedSnapshot = null;

/** Prerender/SSR fallback — this app only ever runs in the browser. */
const SERVER_SNAPSHOT = { canInstall: false, isInstalled: false, isIos: false };

function getState() {
  return {
    canInstall: deferredPrompt != null,
    isInstalled: installedViaEvent || isStandalone(),
    // iOS/iPadOS has no `beforeinstallprompt`, so installs are always manual.
    isIos: isIos(),
  };
}

function getSnapshot() {
  if (cachedSnapshot == null) cachedSnapshot = getState();
  return cachedSnapshot;
}

function getServerSnapshot() {
  return SERVER_SNAPSHOT;
}

function subscribe(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit() {
  const next = getState();
  const changed =
    cachedSnapshot == null ||
    cachedSnapshot.canInstall !== next.canInstall ||
    cachedSnapshot.isInstalled !== next.isInstalled ||
    cachedSnapshot.isIos !== next.isIos;
  cachedSnapshot = next;
  if (!changed) return;
  for (const listener of listeners) listener();
}

/** True once the app is running as an installed app rather than a tab. */
function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches === true ||
    // iOS Safari predates `display-mode` and exposes its own flag.
    window.navigator.standalone === true
  );
}

function isIos() {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent || "";
  // iPadOS 13+ reports itself as a desktop Mac, so touch support gives it away.
  return (
    /iPad|iPhone|iPod/.test(ua) ||
    (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1)
  );
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Deliberately *not* calling preventDefault(): that would suppress the
    // browser's own install promotion (e.g. Chrome's Android mini-infobar),
    // which is usually a better discovery path than our Settings row. Keeping
    // the event lets our button replay the same prompt.
    deferredPrompt = event;
    emit();
  });

  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    installedViaEvent = true;
    emit();
  });

  // Installing from another tab flips the display mode without reloading this one.
  window
    .matchMedia?.("(display-mode: standalone)")
    ?.addEventListener?.("change", emit);
}

export function useInstallPrompt() {
  const state = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const promptInstall = useCallback(async () => {
    const prompt = deferredPrompt;
    if (!prompt) return "unavailable";
    try {
      prompt.prompt();
      const choice = await prompt.userChoice;
      return choice?.outcome === "accepted" ? "accepted" : "dismissed";
    } finally {
      // A deferred prompt is single-use, so drop it either way.
      deferredPrompt = null;
      emit();
    }
  }, []);

  return { ...state, promptInstall };
}

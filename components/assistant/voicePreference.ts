"use client";

/**
 * Whether the assistant is allowed to speak — a tiny external store.
 *
 * An external store rather than `useState` plus an effect that reads
 * storage, because that shape is a hydration bug waiting to happen: the
 * server renders the default, the client's first paint renders the default
 * too, and only then does an effect correct it — which React now flags,
 * correctly, as a cascading render.
 *
 * `useSyncExternalStore` is the primitive built for exactly this: a value
 * that lives outside React, has a different answer on the server, and can
 * change from somewhere other than a render. The same pattern the project
 * already uses in `components/ui/useHydrated.ts`.
 *
 * It also earns its keep beyond the lint rule: the `storage` event means
 * switching the voice off in one tab switches it off in every other one.
 */

const KEY = "mfos.assistant.voice";

let cached: boolean | null = null;
const listeners = new Set<() => void>();

function read(): boolean {
  if (cached !== null) return cached;
  try {
    cached = window.localStorage.getItem(KEY) !== "off";
  } catch {
    // Private window, or site data blocked. On by default, and the choice
    // simply will not be remembered.
    cached = true;
  }
  return cached;
}

function emit(): void {
  for (const listener of listeners) listener();
}

export function subscribeVoicePreference(listener: () => void): () => void {
  listeners.add(listener);

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== KEY) return;
    cached = null;
    emit();
  };

  window.addEventListener("storage", onStorage);

  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function getVoicePreference(): boolean {
  return read();
}

/** The server has no storage and no opinion: on, like the default. */
export function getVoicePreferenceServer(): boolean {
  return true;
}

export function setVoicePreference(on: boolean): void {
  cached = on;
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // No storage, no memory of the choice. It still applies right now.
  }
  emit();
}

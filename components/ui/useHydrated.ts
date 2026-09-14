"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

/**
 * True once this component has hydrated on the client.
 *
 * This exists because of a failure mode found by watching the network
 * rather than the screen: React renders a `useActionState` form with
 * `action="javascript:throw …"`, which makes a submit **before hydration**
 * do absolutely nothing — no request, no error, no console message. The
 * button looks enabled, the click lands, and the application silently
 * ignores it.
 *
 * Every mutating form in this app uses `useActionState`, so every one of
 * them has a window at the start of a page's life where it lies about
 * being ready. The window is short on a fast connection and is not short
 * on a slow one, and it never closes at all if the JavaScript fails to
 * load.
 *
 * Disabling the submit button until this returns true turns a silent
 * no-op into a visibly not-yet-ready control. That is a real improvement
 * even though it is not a fix for the underlying limitation: with
 * JavaScript unavailable the form cannot work either way, and a control
 * that says so beats one that pretends.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: the server
 * snapshot is false and the client snapshot is true, so the value is
 * correct during hydration itself rather than one paint later.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}

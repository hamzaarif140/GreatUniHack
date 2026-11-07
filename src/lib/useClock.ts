"use client";

import { useSyncExternalStore } from "react";

function subscribe(onChange: () => void) {
  const interval = setInterval(onChange, 1000);
  return () => clearInterval(interval);
}

function readTime() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** The current time as "12:50". Empty on the server, so hydration stays consistent. */
export function useClock() {
  return useSyncExternalStore(subscribe, readTime, () => "");
}

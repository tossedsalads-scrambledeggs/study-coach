"use client";

import { useCallback, useEffect, useState } from "react";

export type FetchState<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: T };

/** GET a JSON route from the browser. Keeps old data on screen while a refresh is in flight. */
export function useFetchJson<T>(url: string): FetchState<T> & { reload: () => void } {
  const [state, setState] = useState<FetchState<T>>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!res.ok) throw new Error(`status ${res.status}`);
        setState({ status: "ready", data: (await res.json()) as T });
      } catch {
        if (controller.signal.aborted) return;
        setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: "Couldn't load this." }));
      }
    })();
    return () => controller.abort();
  }, [url, tick]);

  return { ...state, reload };
}

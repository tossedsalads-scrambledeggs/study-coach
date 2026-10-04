"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import type { CourseView } from "@/lib/contracts";

export type CourseState =
  | { status: "loading" }
  | { status: "none" }
  | { status: "error"; message: string }
  | { status: "ready"; view: CourseView };

type CourseContextValue = { state: CourseState; reload: () => void };

const CourseContext = createContext<CourseContextValue>({ state: { status: "loading" }, reload: () => {} });

async function loadCourse(signal: AbortSignal): Promise<CourseState> {
  try {
    const res = await fetch("/api/courses/current", { cache: "no-store", signal });
    if (res.status === 404) return { status: "none" };
    if (!res.ok) return { status: "error", message: `The course service answered with ${res.status}.` };
    const view = (await res.json()) as Partial<CourseView> | null;
    if (!view || !view.course) return { status: "none" };
    return { status: "ready", view: view as CourseView };
  } catch (err) {
    if (signal.aborted) throw err;
    return { status: "error", message: "Couldn't reach the course service." };
  }
}

/** Loads the current course once for the whole shell, and again when the route changes or the tab regains focus. */
export function CourseProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [state, setState] = useState<CourseState>({ status: "loading" });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    loadCourse(controller.signal)
      .then((next) => setState(next))
      .catch(() => {});
    return () => controller.abort();
  }, [pathname, tick]);

  useEffect(() => {
    const onFocus = () => setTick((n) => n + 1);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  const value = useMemo(() => ({ state, reload }), [state, reload]);
  return <CourseContext.Provider value={value}>{children}</CourseContext.Provider>;
}

export const useCourse = () => useContext(CourseContext);

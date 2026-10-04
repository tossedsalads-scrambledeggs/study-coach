"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ChevronDownIcon, RefreshCwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { PROGRESS_EVENT } from "@/components/tool-ui";
import { cn } from "@/lib/utils";

type UnitRow = { unitNumber: number; total: number; passed: number };

export type TrackerState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rows: UnitRow[] };

function parseRows(body: unknown): UnitRow[] | null {
  const byUnit = (body as { byUnit?: unknown } | null)?.byUnit;
  if (!Array.isArray(byUnit)) return null;
  const rows: UnitRow[] = [];
  for (const r of byUnit as Partial<UnitRow>[]) {
    if (typeof r?.unitNumber === "number" && typeof r.total === "number" && typeof r.passed === "number") {
      rows.push({ unitNumber: r.unitNumber, total: r.total, passed: r.passed });
    }
  }
  return rows.sort((a, b) => a.unitNumber - b.unitNumber);
}

/** Passed / total per unit from GET /api/quiz/tracker. Refreshes when a quiz answer is graded. */
export function QuizTracker({ className }: { className?: string }) {
  const [state, setState] = useState<TrackerState>({ status: "loading" });

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/quiz/tracker", { cache: "no-store", signal });
      if (!res.ok) throw new Error(`status ${res.status}`);
      const rows = parseRows(await res.json());
      if (!rows) throw new Error("unexpected shape");
      setState({ status: "ready", rows });
    } catch {
      if (signal?.aborted) return;
      setState((prev) => (prev.status === "ready" ? prev : { status: "error", message: "Couldn't load your progress." }));
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    load(controller.signal);
    const refresh = () => load();
    window.addEventListener(PROGRESS_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      controller.abort();
      window.removeEventListener(PROGRESS_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);

  return <QuizTrackerView state={state} onRetry={() => load()} className={className} />;
}

/** The tracker panel for any state, so loading, error, empty and ready can each be rendered and checked. */
export function QuizTrackerView({
  state,
  onRetry,
  className,
}: {
  state: TrackerState;
  onRetry: () => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false); // small screens only; large screens always show the list

  const rows = state.status === "ready" ? state.rows : [];
  const total = rows.reduce((n, r) => n + r.total, 0);
  const passed = rows.reduce((n, r) => n + r.passed, 0);

  return (
    <section aria-labelledby="tracker-heading" className={cn("px-4 py-3 sm:px-6 lg:px-5 lg:py-5", className)}>
      <div className="flex items-center gap-2">
        <h2 id="tracker-heading" className="text-sm font-semibold tracking-tight">
          Your progress
        </h2>
        <div className="ml-auto flex items-center gap-1">
          {state.status === "ready" && total > 0 ? (
            <span className="text-muted-foreground text-sm tabular-nums">
              {passed} of {total} passed
            </span>
          ) : null}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="tracker-units"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mr-1 rounded-md p-1 outline-none focus-visible:ring-2 lg:hidden"
            aria-label={open ? "Hide progress by unit" : "Show progress by unit"}
          >
            <ChevronDownIcon aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", open && "rotate-180")} />
          </button>
        </div>
      </div>

      <div id="tracker-units" className={cn("mt-3", open ? "block" : "hidden", "lg:block")}>
        {state.status === "loading" ? (
          <div role="status" aria-label="Loading your progress" className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="space-y-1.5">
                <Skeleton className="h-3.5 w-20 motion-reduce:animate-none" />
                <Skeleton className="h-2 w-full motion-reduce:animate-none" />
              </div>
            ))}
          </div>
        ) : state.status === "error" ? (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-muted-foreground">{state.message}</p>
            <Button variant="outline" size="sm" onClick={onRetry}>
              <RefreshCwIcon aria-hidden />
              Try again
            </Button>
          </div>
        ) : rows.length === 0 ? (
          <div className="space-y-1.5 text-sm">
            <p className="font-medium">No method lines yet</p>
            <p className="text-muted-foreground">
              Lines appear once your course is planned.{" "}
              <Link
                href="/plan"
                className="text-foreground focus-visible:ring-ring/50 rounded-sm font-medium underline underline-offset-4 outline-none focus-visible:ring-2"
              >
                Open the study plan
              </Link>
            </p>
          </div>
        ) : (
          <ul className="space-y-3.5">
            {rows.map((r) => {
              const pct = r.total > 0 ? Math.round((r.passed / r.total) * 100) : 0;
              const complete = r.total > 0 && r.passed >= r.total;
              return (
                <li key={r.unitNumber} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-sm">
                    <span className="font-medium">Unit {r.unitNumber}</span>
                    <span className="text-muted-foreground tabular-nums">
                      {r.passed} / {r.total}
                    </span>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={`Unit ${r.unitNumber}`}
                    aria-valuemin={0}
                    aria-valuemax={r.total}
                    aria-valuenow={r.passed}
                    aria-valuetext={`${r.passed} of ${r.total} lines passed`}
                    className="bg-muted h-2 overflow-hidden rounded-full"
                  >
                    <div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none",
                        complete ? "bg-emerald-600 dark:bg-emerald-500" : "bg-foreground/70",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {state.status === "ready" && rows.length > 0 ? (
          <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
            One pass retires a line. Lines you miss stay in the quiz.
          </p>
        ) : null}
      </div>
    </section>
  );
}

"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { MessageSquare, RefreshCw } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { CourseView, ErrorLogEntry } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { DueToday } from "./due-today";
import { ErrorTable } from "./error-table";
import { LogMistakeForm } from "./log-form";
import { NO_COURSE_MESSAGE, Notice, api, messageOf } from "./parts";
import type { DueEntry } from "./parts";

/** Error log: due re-drills, a form to log a problem, and the full log table. */

type Loaded = { entries: ErrorLogEntry[]; due: DueEntry[] };

function DueSkeleton() {
  return (
    <div className="space-y-3" aria-hidden="true">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

function TableSkeleton() {
  return (
    <div className="space-y-2 rounded-xl border p-3" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export default function ErrorsPage() {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [currentUnit, setCurrentUnit] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [all, due] = await Promise.all([
        api<{ entries: ErrorLogEntry[] }>("/api/errors"),
        api<{ entries: DueEntry[] }>("/api/errors/due"),
      ]);
      setData({ entries: all.entries, due: due.entries });
      setError(null);
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Pre-fill the unit in the form. Best effort: the plan page may not exist yet, so ignore failures.
  useEffect(() => {
    let alive = true;
    api<CourseView>("/api/courses/current")
      .then((view) => {
        if (alive && typeof view?.currentUnit === "number") setCurrentUnit(view.currentUnit);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const dueIds = useMemo(() => new Set((data?.due ?? []).map((d) => d.id)), [data]);
  const noCourse = error === NO_COURSE_MESSAGE;
  const firstLoad = loading && data == null;

  return (
    <div className="mx-auto w-full max-w-[90rem] space-y-10 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">Error log</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            Every mistake, what went wrong, and when it comes back. A problem you get right on its re-drill date is
            cleared and moves to your shuffle pile.
          </p>
        </div>
        <Link href="/log" className={cn(buttonVariants({ variant: "outline", size: "lg" }))}>
          <MessageSquare aria-hidden="true" data-icon="inline-start" />
          Log it in the coach chat
        </Link>
      </header>

      {noCourse ? (
        <Notice tone="info" title="Set up your course first">
          <p>
            The error log hangs off your course, so the coach knows your units and weeks.{" "}
            <Link href="/plan" className="font-medium underline underline-offset-4">
              Create a study plan
            </Link>{" "}
            and come back.
          </p>
        </Notice>
      ) : (
        <>
          {error && (
            <Notice tone="error" title="Could not load your error log">
              <p>{error}</p>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()} disabled={loading}>
                <RefreshCw aria-hidden="true" data-icon="inline-start" />
                Try again
              </Button>
            </Notice>
          )}

          <div className="max-w-4xl space-y-10">
            {firstLoad && !error ? (
              <DueSkeleton />
            ) : data ? (
              <DueToday due={data.due} entries={data.entries} onChanged={() => void load()} />
            ) : null}

            <LogMistakeForm defaultUnit={currentUnit} onLogged={() => void load()} />
          </div>

          {(data || firstLoad) && (
            <section aria-labelledby="log-table-heading" className="space-y-4" aria-busy={loading}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 id="log-table-heading" className="text-lg font-semibold text-balance">
                  All mistakes
                </h2>
                {data && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {data.entries.length} logged, {data.entries.filter((e) => e.cleared).length} cleared
                  </span>
                )}
              </div>

              {!data ? (
                <TableSkeleton />
              ) : data.entries.length === 0 ? (
                <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                  No mistakes logged yet. When a problem goes wrong, add it above and the coach will explain what
                  happened and schedule a re-drill.
                </div>
              ) : (
                <ErrorTable entries={data.entries} dueIds={dueIds} />
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}

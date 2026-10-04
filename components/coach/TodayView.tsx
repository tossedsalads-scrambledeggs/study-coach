"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowRightIcon,
  BrainIcon,
  CalendarClockIcon,
  CalendarRangeIcon,
  NotebookPenIcon,
  RefreshCwIcon,
  ShuffleIcon,
  type LucideIcon,
} from "lucide-react";
import type { ErrorLogEntry } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useCourse, type CourseState } from "./CourseContext";
import { useFetchJson, type FetchState } from "./useFetchJson";

type DueBody = { entries?: (Partial<ErrorLogEntry> & { statement?: string })[] };
type TrackerBody = { byUnit?: { unitNumber: number; total: number; passed: number }[] };
type ErrorsBody = { entries?: Partial<ErrorLogEntry>[] };

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function formatDay(iso: string | undefined): string | null {
  const m = iso ? /^(\d{4})-(\d{2})-(\d{2})/.exec(iso) : null;
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatCard({
  href,
  icon: Icon,
  title,
  cta,
  state,
  onRetry,
  render,
}: {
  href: string;
  icon: LucideIcon;
  title: string;
  cta: string;
  state: FetchState<unknown>;
  onRetry: () => void;
  render: () => { value: ReactNode; caption: ReactNode };
}) {
  const content = state.status === "ready" ? render() : null;
  return (
    <div
      className={cn(
        "group bg-card relative flex flex-col rounded-xl border p-5 shadow-xs transition-[border-color,box-shadow] motion-reduce:transition-none",
        "hover:border-foreground/25 hover:shadow-sm focus-within:border-foreground/25",
      )}
    >
      <div className="text-muted-foreground flex items-center gap-2 text-sm font-medium">
        <Icon aria-hidden className="size-4" />
        <h2>{title}</h2>
      </div>

      {state.status === "loading" ? (
        <div role="status" aria-label={`Loading ${title}`} className="mt-4 space-y-2.5">
          <Skeleton className="h-10 w-16 motion-reduce:animate-none" />
          <Skeleton className="h-4 w-40 motion-reduce:animate-none" />
        </div>
      ) : state.status === "error" ? (
        <div role="alert" className="mt-4 space-y-2 text-sm">
          <p className="text-muted-foreground">Couldn&rsquo;t load this one.</p>
          <Button variant="outline" size="sm" className="relative z-10" onClick={onRetry}>
            <RefreshCwIcon aria-hidden />
            Try again
          </Button>
        </div>
      ) : (
        <div className="mt-3">
          <p className="text-4xl font-semibold tracking-tight tabular-nums">{content?.value}</p>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">{content?.caption}</p>
        </div>
      )}

      <div className="mt-auto pt-5">
        <Link
          href={href}
          className="focus-visible:ring-ring/50 inline-flex w-fit items-center gap-1 rounded-sm text-sm font-medium outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:ring-2 focus-visible:after:ring-ring/50 group-hover:underline group-hover:underline-offset-4"
        >
          {cta}
          <ArrowRightIcon aria-hidden className="size-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </Link>
      </div>
    </div>
  );
}

function NoCourse() {
  return (
    <section className="bg-card flex flex-col items-start gap-4 rounded-xl border p-6 shadow-xs sm:p-8">
      <span aria-hidden className="bg-muted grid size-10 place-items-center rounded-lg">
        <CalendarRangeIcon className="size-5" />
      </span>
      <div className="space-y-1.5">
        <h2 className="text-lg font-semibold tracking-tight text-balance">No course yet</h2>
        <p className="text-muted-foreground max-w-prose text-pretty">
          Give me your syllabus, or the link to your course website, and I&rsquo;ll lay out the weeks, the units and the
          method lines to learn. Then this page shows what needs you today.
        </p>
      </div>
      <Link
        href="/plan"
        className="bg-primary text-primary-foreground hover:bg-primary/85 focus-visible:ring-ring/50 inline-flex h-9 items-center gap-1.5 rounded-lg px-4 text-sm font-medium outline-none focus-visible:ring-3"
      >
        Plan your course
        <ArrowRightIcon aria-hidden className="size-4" />
      </Link>
    </section>
  );
}

function TodaySkeleton() {
  return (
    <div role="status" aria-label="Loading today" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="bg-card space-y-3 rounded-xl border p-5 shadow-xs">
          <Skeleton className="h-4 w-28 motion-reduce:animate-none" />
          <Skeleton className="h-10 w-16 motion-reduce:animate-none" />
          <Skeleton className="h-4 w-40 motion-reduce:animate-none" />
        </div>
      ))}
    </div>
  );
}

type Loadable<T> = FetchState<T> & { reload: () => void };

export type TodayContentProps = {
  course: { state: CourseState; reload: () => void };
  due: Loadable<DueBody>;
  tracker: Loadable<TrackerBody>;
  errors: Loadable<ErrorsBody>;
  dateLabel: string | null;
};

/** Everything on the Today page, driven by plain props so every state can be rendered and checked. */
export function TodayContent({ course, due, tracker, errors, dateLabel }: TodayContentProps) {
  const view = course.state.status === "ready" ? course.state.view : null;
  const unitTitle = view?.units?.find((u) => u.number === view.currentUnit)?.title ?? null;
  const dueEntries = due.status === "ready" ? (due.data.entries ?? []) : [];

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 px-4 py-8 sm:px-6 sm:py-10">
      <header className="space-y-1.5">
        <p className="text-muted-foreground text-sm tabular-nums">{dateLabel ?? " "}</p>
        <h1 className="text-3xl font-semibold tracking-tight text-balance">Today</h1>
        {view ? (
          <p className="text-muted-foreground text-pretty">
            You&rsquo;re in Unit {view.currentUnit}
            {unitTitle ? `, ${unitTitle}` : ""}. Here&rsquo;s what needs you.
          </p>
        ) : null}
      </header>

      {course.state.status === "loading" ? (
        <TodaySkeleton />
      ) : course.state.status === "none" ? (
        <NoCourse />
      ) : (
        <>
          {course.state.status === "error" ? (
            <div role="alert" className="bg-muted/40 flex flex-wrap items-center gap-3 rounded-lg border px-4 py-3 text-sm">
              <p className="text-muted-foreground">{course.state.message}</p>
              <Button variant="outline" size="sm" onClick={course.reload}>
                <RefreshCwIcon aria-hidden />
                Try again
              </Button>
            </div>
          ) : null}

          <section aria-label="What needs you today" className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <StatCard
              href="/errors"
              icon={CalendarClockIcon}
              title="Re-drills due"
              cta="Open error log"
              state={due}
              onRetry={due.reload}
              render={() => ({
                value: dueEntries.length,
                caption:
                  dueEntries.length === 0
                    ? "Nothing due today. Nicely done."
                    : `${plural(dueEntries.length, "problem is", "problems are")} ready to try again.`,
              })}
            />
            <StatCard
              href="/quiz"
              icon={BrainIcon}
              title="Method lines left"
              cta="Start a quiz"
              state={tracker}
              onRetry={tracker.reload}
              render={() => {
                const rows = tracker.status === "ready" ? (tracker.data.byUnit ?? []) : [];
                const total = rows.reduce((n, r) => n + r.total, 0);
                const passed = rows.reduce((n, r) => n + r.passed, 0);
                return {
                  value: Math.max(total - passed, 0),
                  caption:
                    total === 0
                      ? "No method lines in reach yet."
                      : `${passed} of ${total} ${plural(total, "line", "lines")} passed so far.`,
                };
              }}
            />
            <StatCard
              href="/shuffle"
              icon={ShuffleIcon}
              title="Shuffle pile"
              cta="Open shuffle pile"
              state={errors}
              onRetry={errors.reload}
              render={() => {
                const cleared = (errors.status === "ready" ? (errors.data.entries ?? []) : []).filter((e) => e.cleared).length;
                return {
                  value: cleared,
                  caption:
                    cleared === 0
                      ? "Clear a re-drill and the problem lands here as a fresh variant."
                      : `${plural(cleared, "problem", "problems")} cleared. Each can come back with a new surface.`,
                };
              }}
            />
          </section>

          {due.status === "ready" && dueEntries.length > 0 ? (
            <section aria-labelledby="due-heading" className="space-y-3">
              <div className="flex items-baseline justify-between gap-3">
                <h2 id="due-heading" className="text-lg font-semibold tracking-tight">
                  Due now
                </h2>
                <Link
                  href="/errors"
                  className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 rounded-sm text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2"
                >
                  See all
                </Link>
              </div>
              <ul className="bg-card divide-y rounded-xl border shadow-xs">
                {dueEntries.slice(0, 4).map((e, i) => {
                  const day = formatDay(e.redrillOn);
                  return (
                    <li key={e.id ?? i}>
                      <Link
                        href="/errors"
                        className="hover:bg-muted/50 focus-visible:ring-ring/50 flex items-center gap-3 px-4 py-3 outline-none first:rounded-t-xl last:rounded-b-xl focus-visible:ring-2 focus-visible:ring-inset"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-medium">{e.problemLabel ?? "Problem"}</p>
                          <p className="text-muted-foreground truncate text-sm tabular-nums">
                            {e.unitNumber != null ? `Unit ${e.unitNumber}` : "Re-drill"}
                            {day ? ` · due ${day}` : ""}
                          </p>
                        </div>
                        <ArrowRightIcon aria-hidden className="text-muted-foreground size-4 shrink-0" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="quick-heading" className="space-y-3">
            <h2 id="quick-heading" className="text-lg font-semibold tracking-tight">
              Pick something to do
            </h2>
            <div className="flex flex-wrap gap-3">
              <Link
                href="/log"
                className="bg-card hover:bg-muted/50 focus-visible:ring-ring/50 inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-xs outline-none focus-visible:ring-2"
              >
                <NotebookPenIcon aria-hidden className="size-4" />
                Log a mistake
              </Link>
              <Link
                href="/quiz"
                className="bg-card hover:bg-muted/50 focus-visible:ring-ring/50 inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-medium shadow-xs outline-none focus-visible:ring-2"
              >
                <BrainIcon aria-hidden className="size-4" />
                Quiz me on a method
              </Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export function TodayView() {
  const course = useCourse();
  const due = useFetchJson<DueBody>("/api/errors/due");
  const tracker = useFetchJson<TrackerBody>("/api/quiz/tracker");
  const errors = useFetchJson<ErrorsBody>("/api/errors");

  const [dateLabel, setDateLabel] = useState<string | null>(null);
  useEffect(() => {
    setDateLabel(new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }));
  }, []);

  return <TodayContent course={course} due={due} tracker={tracker} errors={errors} dateLabel={dateLabel} />;
}

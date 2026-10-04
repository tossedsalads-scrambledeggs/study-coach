"use client";

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { CalendarDays, CircleAlert, ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import type { CourseView, Unit, Week } from "@/lib/contracts";

// ---------------------------------------------------------------------------
// Small helpers: dates are ISO "YYYY-MM-DD" strings; format them in UTC so they never shift a day.
// ---------------------------------------------------------------------------

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fullFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function fromISO(iso: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

function plusDays(iso: string, days: number): string {
  const d = fromISO(iso);
  if (!d) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function formatDay(iso: string | null | undefined, withYear = false): string {
  const d = fromISO(iso);
  return d ? (withYear ? fullFormat : dayFormat).format(d) : "—";
}

function formatRange(start: string | null, end: string | null): string {
  if (!start && !end) return "—";
  if (!end || end === start) return formatDay(start);
  if (!start) return formatDay(end);
  return `${formatDay(start)} – ${formatDay(end)}`;
}

function localToday(): string {
  const n = new Date();
  const p = (v: number) => String(v).padStart(2, "0");
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`;
}

/** The unit the calendar says we are in (same rule as the server: latest unit that has started, else 1). */
function calendarUnit(units: Unit[], today: string): number {
  const started = units.filter((u) => u.startDate && u.startDate <= today).map((u) => u.number);
  return started.length > 0 ? Math.max(...started) : 1;
}

function hours(value: number | null | undefined): string {
  return value == null ? "—" : String(Math.round(value * 10) / 10);
}

function withScheme(url: string): string {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(url) ? url : `https://${url}`;
}

// ---------------------------------------------------------------------------
// REST calls
// ---------------------------------------------------------------------------

async function readError(res: Response): Promise<string> {
  const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
  return typeof data?.error === "string" && data.error ? data.error : `Something went wrong (${res.status}).`;
}

/** Turn a thrown value into a message a student can act on (network drops, slow or busy AI model). */
function networkError(err: unknown): Error {
  if (err instanceof TypeError) return new Error("Could not reach the server. Check your connection and try again.");
  const message = err instanceof Error ? err.message : String(err);
  if (/AI Gateway 504|took too long/i.test(message)) {
    return new Error("The AI model took too long to answer. Try again; a shorter syllabus can help.");
  }
  if (/AI Gateway 429/i.test(message)) {
    return new Error("The AI model is busy right now. Wait a minute and try again.");
  }
  return err instanceof Error ? err : new Error(message);
}

async function fetchCurrent(): Promise<CourseView | null> {
  try {
    const res = await fetch("/api/courses/current", { cache: "no-store" });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await readError(res));
    return (await res.json()) as CourseView;
  } catch (err) {
    throw networkError(err);
  }
}

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const fieldLabel = "text-sm font-medium";
const helpText = "text-sm text-muted-foreground";
const selectClass =
  "h-8 min-w-0 max-w-full rounded-lg border border-input bg-background px-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30";
const cell = "px-3 py-2.5 align-top";
const headBase = "px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground";
const headCell = `${headBase} text-left`;
const headCellRight = `${headBase} text-right`;

function ErrorNotice({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
    >
      <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words">{message}</p>
      {onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          <RefreshCw aria-hidden="true" />
          Try again
        </Button>
      ) : null}
    </div>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return <LoaderCircle className={`size-4 animate-spin motion-reduce:animate-none ${className}`} aria-hidden="true" />;
}

function DifficultyMeter({ value }: { value: number | null }) {
  const level = value == null ? 0 : Math.min(5, Math.max(0, Math.round(value)));
  return (
    <span
      role="img"
      aria-label={value == null ? "Difficulty not rated" : `Difficulty ${level} of 5`}
      className="inline-flex items-center gap-1.5"
    >
      <span className="flex gap-0.5" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`h-3 w-2 rounded-sm ${n <= level ? "bg-foreground" : "bg-muted"}`} />
        ))}
      </span>
      <span className="text-sm tabular-nums" aria-hidden="true">
        {value == null ? "—" : `${level}/5`}
      </span>
    </span>
  );
}

function PlanSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-live="polite">
      <span className="sr-only">Loading your study plan</span>
      <Skeleton className="h-9 w-64" />
      <Skeleton className="h-10 w-full max-w-sm" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  );
}

function PlanForm({
  hasPlan,
  onCreated,
  onCancel,
}: {
  hasPlan: boolean;
  onCreated: () => void;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [syllabus, setSyllabus] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!busy) return;
    setSeconds(0);
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [busy]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const courseUrl = url.trim();
    const syllabusText = syllabus.trim();
    if (!courseUrl && !syllabusText) {
      setError("Add the course website or paste the syllabus, so there is something to plan from.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/courses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim() || undefined,
          courseUrl: courseUrl ? withScheme(courseUrl) : undefined,
          syllabusText: syllabusText || undefined,
        }),
      });
      if (!res.ok) throw new Error(await readError(res));
      setBusy(false);
      onCreated();
    } catch (err) {
      setError(networkError(err).message);
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      noValidate
      className="space-y-5 rounded-xl border bg-card p-5 text-card-foreground"
      aria-busy={busy}
    >
      <div className="space-y-1.5">
        <label htmlFor="plan-title" className={fieldLabel}>
          Course name <span className="font-normal text-muted-foreground">(optional)</span>
        </label>
        <Input
          id="plan-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Probability, Stat 110"
          autoComplete="off"
          disabled={busy}
        />
        <p className={helpText}>Leave it blank and the coach uses the name it finds in the material.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="plan-url" className={fieldLabel}>
          Course website
        </label>
        <Input
          id="plan-url"
          type="url"
          inputMode="url"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://stat110.hsites.harvard.edu"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
        />
        <p className={helpText}>The coach reads the page and looks for the syllabus and schedule on the same site.</p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="plan-syllabus" className={fieldLabel}>
          Or paste the syllabus
        </label>
        <Textarea
          id="plan-syllabus"
          value={syllabus}
          onChange={(e) => setSyllabus(e.target.value)}
          placeholder="Week 1: Probability and counting. Lectures 1-2. Problem set 1 due Friday..."
          rows={7}
          className="max-h-96 overflow-y-auto"
          disabled={busy}
        />
        <p className={helpText}>Use either one, or both. Text copied from a PDF works too.</p>
      </div>

      {error ? <ErrorNotice message={error} /> : null}

      {busy ? (
        <p role="status" className="flex items-start gap-2 text-sm text-muted-foreground">
          <Spinner className="mt-0.5 shrink-0" />
          <span>
            Reading the course, laying out the weeks and drafting your method sheet. This usually takes a minute or
            two, so keep this tab open.{" "}
            <span className="tabular-nums">{seconds}s</span>
          </span>
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={busy}>
          {busy ? "Building your plan..." : hasPlan ? "Build a new plan" : "Build my plan"}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        ) : null}
      </div>
      {hasPlan ? (
        <p className={helpText}>The new plan replaces the one you are on now as your current course.</p>
      ) : null}
    </form>
  );
}

function CurrentUnitPicker({ view, onChanged }: { view: CourseView; onChanged: () => Promise<void> }) {
  const { units, course, currentUnit } = view;
  const override = course.currentUnitOverride;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const auto = calendarUnit(units, localToday());

  async function choose(value: string) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/courses/current", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentUnitOverride: value === "auto" ? null : Number(value) }),
      });
      if (!res.ok) throw new Error(await readError(res));
      await onChanged();
    } catch (err) {
      setError(networkError(err).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="current-unit" className={fieldLabel}>
          Current unit
        </label>
        <select
          id="current-unit"
          className={selectClass}
          value={override == null ? "auto" : String(override)}
          disabled={saving}
          onChange={(e) => void choose(e.target.value)}
        >
          <option value="auto">Auto (follow the calendar: Unit {auto})</option>
          {units.map((u) => (
            <option key={u.number} value={String(u.number)}>
              Unit {u.number}: {u.title}
            </option>
          ))}
        </select>
        {saving ? (
          <span role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <Spinner /> Saving
          </span>
        ) : null}
      </div>
      <p className={helpText} aria-live="polite">
        {override == null
          ? `You are on Unit ${currentUnit}, following the calendar.`
          : `You pinned Unit ${currentUnit}. Choose Auto to follow the calendar again.`}{" "}
        The quiz and the re-drill dates use this.
      </p>
      {error ? <ErrorNotice message={error} /> : null}
    </div>
  );
}

function ScrollTable({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      role="region"
      aria-label={label}
      tabIndex={0}
      className="overflow-x-auto rounded-xl border outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {children}
    </div>
  );
}

function UnitSummary({ units, currentUnit }: { units: Unit[]; currentUnit: number }) {
  const total = units.reduce((sum, u) => sum + (u.estHours ?? 0), 0);
  return (
    <section aria-labelledby="units-heading" className="space-y-3">
      <h2 id="units-heading" className="text-balance text-lg font-semibold tracking-tight">
        Units
      </h2>
      <ScrollTable label="Unit summary">
        <table className="w-full min-w-[40rem] border-collapse text-sm">
          <caption className="sr-only">Units with dates, study hours and difficulty</caption>
          <thead className="border-b bg-muted/40">
            <tr>
              <th scope="col" className={headCell}>
                Unit
              </th>
              <th scope="col" className={headCell}>
                Dates
              </th>
              <th scope="col" className={headCellRight}>
                Hours
              </th>
              <th scope="col" className={headCell}>
                Difficulty
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {units.map((u) => (
              <tr key={u.number} className={u.number === currentUnit ? "bg-muted/50" : undefined}>
                <th scope="row" className={`${cell} text-left font-medium`}>
                  <span className="tabular-nums">{u.number}.</span> {u.title}
                  {u.number === currentUnit ? (
                    <span className="ml-2 rounded-full bg-foreground px-2 py-0.5 align-middle text-xs font-medium text-background">
                      Current
                    </span>
                  ) : null}
                  {u.lectures || u.topics ? (
                    <span className="mt-0.5 block font-normal text-muted-foreground">
                      {[u.lectures, u.topics].filter(Boolean).join(" · ")}
                    </span>
                  ) : null}
                </th>
                <td className={`${cell} whitespace-nowrap tabular-nums`}>{formatRange(u.startDate, u.endDate)}</td>
                <td className={`${cell} text-right tabular-nums`}>{hours(u.estHours)}</td>
                <td className={cell}>
                  <DifficultyMeter value={u.difficulty} />
                  {u.difficultyReason ? (
                    <span className="mt-1 block max-w-prose text-muted-foreground">{u.difficultyReason}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t bg-muted/40">
            <tr>
              <th scope="row" colSpan={2} className={`${cell} text-left font-medium`}>
                Total study time
              </th>
              <td className={`${cell} text-right font-medium tabular-nums`}>{hours(total)}</td>
              <td className={cell} />
            </tr>
          </tfoot>
        </table>
      </ScrollTable>
    </section>
  );
}

function WeeklyBreakdown({ weeks, currentUnit }: { weeks: Week[]; currentUnit: number }) {
  const today = localToday();
  const total = weeks.reduce((sum, w) => sum + (w.studyHours ?? 0), 0);
  return (
    <section aria-labelledby="weeks-heading" className="space-y-3">
      <h2 id="weeks-heading" className="text-balance text-lg font-semibold tracking-tight">
        Week by week
      </h2>
      <ScrollTable label="Weekly breakdown">
        <table className="w-full min-w-[52rem] border-collapse text-sm">
          <caption className="sr-only">Each week with its dates, unit, lectures, topics, deadlines and study hours</caption>
          <thead className="border-b bg-muted/40">
            <tr>
              <th scope="col" className={headCell}>
                Week
              </th>
              <th scope="col" className={headCell}>
                Dates
              </th>
              <th scope="col" className={headCell}>
                Unit
              </th>
              <th scope="col" className={headCell}>
                Lectures and topics
              </th>
              <th scope="col" className={headCell}>
                Deadlines
              </th>
              <th scope="col" className={headCellRight}>
                Hours
              </th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {weeks.map((w) => {
              const end = plusDays(w.startDate, 6);
              const thisWeek = today >= w.startDate && today <= end;
              return (
                <tr key={w.weekNumber} className={thisWeek ? "bg-muted/50" : undefined}>
                  <th scope="row" className={`${cell} whitespace-nowrap text-left font-medium tabular-nums`}>
                    {w.weekNumber}
                    {thisWeek ? (
                      <span className="ml-2 rounded-full bg-foreground px-2 py-0.5 align-middle text-xs font-medium text-background">
                        This week
                      </span>
                    ) : null}
                  </th>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>{formatRange(w.startDate, end)}</td>
                  <td className={`${cell} whitespace-nowrap tabular-nums`}>
                    {w.unitNumber == null ? (
                      "—"
                    ) : (
                      <span className={w.unitNumber === currentUnit ? "font-medium" : undefined}>{w.unitNumber}</span>
                    )}
                  </td>
                  <td className={`${cell} min-w-64`}>
                    {w.lectures ? <span className="font-medium">{w.lectures}</span> : null}
                    {w.lectures && w.topics ? <span className="text-muted-foreground">{" · "}</span> : null}
                    {w.topics ? <span>{w.topics}</span> : null}
                    {!w.lectures && !w.topics ? <span className="text-muted-foreground">{"—"}</span> : null}
                  </td>
                  <td className={`${cell} min-w-40`}>
                    {w.deadlines ?? <span className="text-muted-foreground">{"—"}</span>}
                  </td>
                  <td className={`${cell} text-right tabular-nums`}>{hours(w.studyHours)}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot className="border-t bg-muted/40">
            <tr>
              <th scope="row" colSpan={5} className={`${cell} text-left font-medium`}>
                Total study time
              </th>
              <td className={`${cell} text-right font-medium tabular-nums`}>{hours(total)}</td>
            </tr>
          </tfoot>
        </table>
      </ScrollTable>
    </section>
  );
}

function PlanView({
  view,
  onChanged,
  onReplace,
}: {
  view: CourseView;
  onChanged: () => Promise<void>;
  onReplace: () => void;
}) {
  const { course, units, weeks } = view;
  const totalHours = units.reduce((sum, u) => sum + (u.estHours ?? 0), 0);
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h2 className="text-balance text-xl font-semibold tracking-tight">{course.title}</h2>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <CalendarDays className="size-4" aria-hidden="true" />
              <span className="tabular-nums">
                {formatDay(course.startDate, true)} to {formatDay(course.endDate, true)}
              </span>
            </span>
            <span className="tabular-nums">
              {weeks.length} weeks, {units.length} units, about {hours(totalHours)} study hours
            </span>
            {course.sourceUrl ? (
              <a
                href={course.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 underline-offset-4 hover:underline"
              >
                Course website
                <ExternalLink className="size-3.5" aria-hidden="true" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : null}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={onReplace}>
          New plan
        </Button>
      </div>

      <CurrentUnitPicker view={view} onChanged={onChanged} />
      <UnitSummary units={units} currentUnit={view.currentUnit} />
      <WeeklyBreakdown weeks={weeks} currentUnit={view.currentUnit} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; view: CourseView | null };

export default function PlanPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [replacing, setReplacing] = useState(false);

  const load = useCallback(async () => {
    try {
      setState({ status: "ready", view: await fetchCurrent() });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const retry = () => {
    setState({ status: "loading" });
    void load();
  };

  const created = () => {
    setReplacing(false);
    setState({ status: "loading" });
    void load();
  };

  const view = state.status === "ready" ? state.view : null;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-8 sm:px-6">
      <header className="space-y-1">
        <h1 className="text-balance text-2xl font-semibold tracking-tight">Study plan</h1>
        <p className="max-w-prose text-muted-foreground">
          Your course laid out week by week: units, lectures, deadlines, how long each unit takes and how hard it is.
        </p>
      </header>

      {state.status === "loading" ? <PlanSkeleton /> : null}

      {state.status === "error" ? <ErrorNotice message={state.message} onRetry={retry} /> : null}

      {state.status === "ready" && !view ? (
        <div className="max-w-2xl space-y-4">
          <div className="space-y-1">
            <h2 className="text-balance text-lg font-semibold tracking-tight">No study plan yet</h2>
            <p className="text-muted-foreground">
              Give the coach your course website or paste the syllabus. It builds the plan and a first method sheet.
            </p>
          </div>
          <PlanForm hasPlan={false} onCreated={created} />
        </div>
      ) : null}

      {state.status === "ready" && view ? (
        replacing ? (
          <div className="max-w-2xl space-y-4">
            <h2 className="text-balance text-lg font-semibold tracking-tight">Build a new plan</h2>
            <PlanForm hasPlan onCreated={created} onCancel={() => setReplacing(false)} />
          </div>
        ) : (
          <PlanView view={view} onChanged={load} onReplace={() => setReplacing(true)} />
        )
      ) : null}
    </div>
  );
}

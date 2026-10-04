"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, RotateCw, X } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { MethodLine } from "@/lib/contracts";
import { cn } from "@/lib/utils";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

/** fetch + JSON; turns the API's `{ error }` bodies into thrown errors. */
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${res.status})`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong.");

type Phase = "loading" | "error" | "ready";
type Action = "approve" | "reject";

export default function MethodsPage() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState("");
  const [lines, setLines] = useState<MethodLine[]>([]);
  const [busy, setBusy] = useState<Record<string, Action>>({});
  const [problems, setProblems] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<{ n: number; text: string } | null>(null);
  const noticeRef = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    document.title = "Method sheet · Study Coach";
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    try {
      const data = await api<{ lines: MethodLine[] }>("/api/method-lines", { signal });
      setLines(data.lines);
      setPhase("ready");
    } catch (e) {
      if (signal?.aborted) return;
      setLoadError(errorText(e));
      setPhase("error");
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  // After a card leaves the pending list, park keyboard focus on the confirmation (no scroll jump);
  // the next Tab lands on the first line still waiting for a decision.
  useEffect(() => {
    if (notice) noticeRef.current?.focus({ preventScroll: true });
  }, [notice]);

  const retry = () => {
    setPhase("loading");
    void load();
  };

  const decide = async (line: MethodLine, action: Action) => {
    setBusy((b) => ({ ...b, [line.id]: action }));
    setProblems(({ [line.id]: _cleared, ...rest }) => rest);
    try {
      if (action === "approve") {
        const { line: approved } = await api<{ line: MethodLine }>(`/api/method-lines/${line.id}/approve`, {
          method: "POST",
        });
        setLines((all) => all.map((l) => (l.id === approved.id ? approved : l)));
        setNotice((prev) => ({ n: (prev?.n ?? 0) + 1, text: `Approved. This line is now on your sheet and in the quiz: ${line.trigger}` }));
      } else {
        await api<{ ok: true }>(`/api/method-lines/${line.id}/reject`, { method: "POST" });
        setLines((all) => all.filter((l) => l.id !== line.id));
        setNotice((prev) => ({ n: (prev?.n ?? 0) + 1, text: `Rejected. This line is off your sheet: ${line.trigger}` }));
      }
    } catch (e) {
      const message = e instanceof ApiError && e.status === 409 ? `Already on your sheet. ${e.message}` : errorText(e);
      setProblems((p) => ({ ...p, [line.id]: message }));
    } finally {
      setBusy(({ [line.id]: _done, ...rest }) => rest);
    }
  };

  const pending = useMemo(() => lines.filter((l) => l.status === "pending"), [lines]);
  const groups = useMemo(() => {
    const byUnit = new Map<number, MethodLine[]>();
    for (const line of lines) {
      if (line.status !== "active") continue;
      byUnit.set(line.unitNumber, [...(byUnit.get(line.unitNumber) ?? []), line]);
    }
    return [...byUnit.entries()]
      .sort(([a], [b]) => a - b)
      .map(([unit, unitLines]) => ({
        unit,
        lines: unitLines,
        passed: unitLines.filter((l) => l.passedAt != null).length,
      }));
  }, [lines]);

  const activeCount = groups.reduce((sum, g) => sum + g.lines.length, 0);
  const passedCount = groups.reduce((sum, g) => sum + g.passed, 0);

  return (
    <section aria-labelledby="methods-title" className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 lg:py-12">
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-2xl">
          <h1 id="methods-title" className="text-balance text-2xl font-semibold tracking-tight sm:text-3xl">
            Method sheet
          </h1>
          <p className="mt-2 text-pretty text-muted-foreground">
            Each line is a situation to spot inside a problem, the move that handles it, and the trap that tempts you
            instead. Pass a line once in the quiz and it retires.
          </p>
        </div>
        {phase === "ready" && activeCount > 0 && (
          <div className="flex items-center gap-4">
            <p className="text-sm text-muted-foreground tabular-nums">
              {passedCount} of {activeCount} passed
            </p>
            <Link href="/quiz" className={buttonVariants({ variant: "outline" })}>
              Quiz me
            </Link>
          </div>
        )}
      </header>

      {phase === "loading" && <LoadingState />}

      {phase === "error" && (
        <div role="alert" className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6">
          <p className="flex items-center gap-2 font-medium">
            <CircleAlert className="size-4 text-destructive" aria-hidden="true" />
            The method sheet did not load.
          </p>
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <Button variant="outline" onClick={retry}>
            <RotateCw aria-hidden="true" />
            Try again
          </Button>
        </div>
      )}

      {phase === "ready" && (
        <>
          <p
            ref={noticeRef}
            role="status"
            tabIndex={-1}
            className={cn(
              "mb-6 rounded-lg outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
              notice && "border border-border bg-muted/50 px-4 py-3 text-sm",
            )}
          >
            {notice?.text}
          </p>

          {lines.length === 0 && <EmptyState />}

          {pending.length > 0 && (
            <section aria-labelledby="pending-title" className="mb-12">
              <h2 id="pending-title" className="text-balance text-lg font-semibold">
                Waiting for your approval <span className="tabular-nums text-muted-foreground">({pending.length})</span>
              </h2>
              <p className="mt-1 mb-4 max-w-2xl text-pretty text-sm text-muted-foreground">
                The coach drafted these from your mistakes. Approve the ones worth drilling and they join the quiz.
              </p>
              <ul className="grid gap-4 lg:grid-cols-2">
                {pending.map((line) => (
                  <li key={line.id}>
                    <PendingCard
                      line={line}
                      busy={busy[line.id]}
                      problem={problems[line.id]}
                      onDecide={(action) => void decide(line, action)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )}

          {lines.length > 0 && (
            <section aria-labelledby="sheet-title">
              <h2 id="sheet-title" className="mb-3 text-balance text-lg font-semibold">
                Your sheet
              </h2>
              {groups.length === 0 ? (
                <p className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
                  No approved lines yet. Approve a line above and it will show up here, grouped by unit.
                </p>
              ) : (
                <div
                  role="region"
                  aria-label="Method sheet, grouped by unit"
                  tabIndex={0}
                  className="overflow-x-auto rounded-xl border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <table className="w-full min-w-[56rem] border-collapse text-left text-sm">
                    <colgroup>
                      <col className="w-16" />
                      <col className="w-28" />
                      <col className="w-[26%]" />
                      <col className="w-[26%]" />
                      <col className="w-[22%]" />
                      <col className="w-32" />
                    </colgroup>
                    <thead>
                      <tr className="bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                        {["Unit", "Lecture", "Trigger", "Move", "Trap", "Source"].map((heading) => (
                          <th key={heading} scope="col" className="px-4 py-2.5 font-medium">
                            {heading}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    {groups.map((group) => (
                      <tbody key={group.unit}>
                        <tr className="border-t border-border bg-muted/30">
                          <th scope="rowgroup" colSpan={6} className="px-4 py-2 text-left text-sm font-semibold">
                            Unit {group.unit}
                            <span className="ml-3 font-normal text-muted-foreground tabular-nums">
                              <span className="sr-only">, </span>
                              {group.passed} of {group.lines.length} passed
                            </span>
                          </th>
                        </tr>
                        {group.lines.map((line) => (
                          <tr key={line.id} className="border-t border-border align-top">
                            <td className="px-4 py-3 tabular-nums text-muted-foreground">{line.unitNumber}</td>
                            <td className="px-4 py-3 text-muted-foreground">{orDash(line.lecture)}</td>
                            <td className="px-4 py-3">
                              <p className="text-pretty">{line.trigger}</p>
                              {line.passedAt && <PassedMark at={line.passedAt} />}
                            </td>
                            <td className="px-4 py-3 text-pretty">{line.move}</td>
                            <td className="px-4 py-3 text-pretty">{line.trap}</td>
                            <td className="px-4 py-3 text-muted-foreground">{orDash(line.source)}</td>
                          </tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </section>
  );
}

function orDash(value: string | null) {
  if (!value) {
    return (
      <>
        <span aria-hidden="true">—</span>
        <span className="sr-only">none</span>
      </>
    );
  }
  return value;
}

function PassedMark({ at }: { at: string }) {
  const date = new Date(at);
  const when = Number.isNaN(date.getTime()) ? null : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return (
    <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
      <Check className="size-3" aria-hidden="true" />
      Passed{when ? ` ${when}` : ""}
    </span>
  );
}

function PendingCard({
  line,
  busy,
  problem,
  onDecide,
}: {
  line: MethodLine;
  busy: Action | undefined;
  problem: string | undefined;
  onDecide: (action: Action) => void;
}) {
  const meta = [`Unit ${line.unitNumber}`, line.lecture, line.source].filter(Boolean).join(" · ");
  return (
    <article className="flex h-full flex-col gap-4 rounded-xl border bg-card p-5 text-card-foreground">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground tabular-nums">{meta}</p>
      <dl className="flex flex-col gap-3 text-sm">
        <Field label="Trigger" value={line.trigger} />
        <Field label="Move" value={line.move} />
        <Field label="Trap" value={line.trap} />
      </dl>
      {problem && (
        <p role="alert" className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{problem}</span>
        </p>
      )}
      <div className="mt-auto flex gap-2">
        <Button disabled={busy !== undefined} onClick={() => onDecide("approve")} aria-label={`Approve: ${line.trigger}`}>
          <Check aria-hidden="true" />
          {busy === "approve" ? "Approving…" : "Approve"}
        </Button>
        <Button
          variant="outline"
          disabled={busy !== undefined}
          onClick={() => onDecide("reject")}
          aria-label={`Reject: ${line.trigger}`}
        >
          <X aria-hidden="true" />
          {busy === "reject" ? "Rejecting…" : "Reject"}
        </Button>
      </div>
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-pretty">{value}</dd>
    </div>
  );
}

function LoadingState() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-3">
      <span className="sr-only">Loading the method sheet…</span>
      <Skeleton className="h-9 w-full motion-reduce:animate-none" />
      {Array.from({ length: 5 }, (_, i) => (
        <Skeleton key={i} className="h-16 w-full motion-reduce:animate-none" />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-14 text-center">
      <h2 className="text-balance text-lg font-semibold">No method lines yet</h2>
      <p className="max-w-md text-pretty text-sm text-muted-foreground">
        Add your course on the plan page and the coach seeds this sheet from the course material. Lines drafted from your
        mistakes show up here for your approval.
      </p>
      <Link href="/plan" className={buttonVariants({ variant: "outline" })}>
        Go to the plan
      </Link>
    </div>
  );
}

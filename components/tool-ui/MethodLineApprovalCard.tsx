"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { makeAssistantToolUI, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { CheckIcon, CircleCheckIcon, CircleXIcon, ListChecksIcon, LoaderCircleIcon, TriangleAlertIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  asNum,
  asRec,
  asStr,
  CardLink,
  Chip,
  Field,
  resolveToolState,
  ToolCard,
  ToolCardError,
  ToolCardLoading,
} from "./shared";

// ---------------------------------------------------------------------------
// What the student decided about a line, shared across cards so a decision made in
// chat ("approve it") also settles the buttons on the diagnosis card.
// ---------------------------------------------------------------------------

type Outcome = { kind: "approved" } | { kind: "rejected" };

const outcomes = new Map<string, Outcome>();
const listeners = new Set<() => void>();

export function recordLineOutcome(id: string, outcome: Outcome) {
  if (outcomes.get(id)?.kind === outcome.kind) return;
  outcomes.set(id, outcome);
  listeners.forEach((l) => l());
}

function useLineOutcome(id: string): Outcome | undefined {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => outcomes.get(id),
    () => undefined,
  );
}

/** Records a decision from an effect, never during render, so other cards can react to it. */
function RecordOutcome({ id, kind }: { id: string | null; kind: Outcome["kind"] }) {
  useEffect(() => {
    if (id) recordLineOutcome(id, { kind });
  }, [id, kind]);
  return null;
}

// ---------------------------------------------------------------------------

export type MethodLineView = {
  id: string;
  trigger: string;
  move: string;
  trap: string;
  unitNumber: number | null;
  lecture: string | null;
};

/** Read a MethodLine-ish object; null when it has no id or no trigger/move/trap to show. */
export function readLine(value: unknown): MethodLineView | null {
  const rec = asRec(value);
  if (!rec) return null;
  const id = asStr(rec.id);
  const trigger = asStr(rec.trigger);
  const move = asStr(rec.move);
  const trap = asStr(rec.trap);
  if (!id || !trigger || !move || !trap) return null;
  return { id, trigger, move, trap, unitNumber: asNum(rec.unitNumber), lecture: asStr(rec.lecture) };
}

function LineFields({ line }: { line: MethodLineView }) {
  return (
    <dl className="space-y-2.5 text-sm">
      <Field label="When you see">{line.trigger}</Field>
      <Field label="Do this">{line.move}</Field>
      <Field label="Watch out for">{line.trap}</Field>
    </dl>
  );
}

type Failure = { status: number; message: string };

/** The approve route answers 409 with "Duplicate of: <the line it matches>". */
export function describeDuplicate(message: string): { lead: string; match: string | null } {
  const m = /^Duplicate of:\s*([\s\S]*)$/i.exec(message.trim());
  const match = m?.[1]?.trim() || null;
  return {
    lead: "Looks like a duplicate.",
    match,
  };
}

/** Approve / Reject for a proposed method line. POSTs to the API from the browser and shows what happened. */
export function MethodLineApprovalCard({ line, className }: { line: MethodLineView; className?: string }) {
  const outcome = useLineOutcome(line.id);
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);

  async function decide(action: "approve" | "reject") {
    setBusy(action);
    setFailure(null);
    try {
      const res = await fetch(`/api/method-lines/${encodeURIComponent(line.id)}/${action}`, { method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
      if (res.ok) {
        recordLineOutcome(line.id, { kind: action === "approve" ? "approved" : "rejected" });
        return;
      }
      const fromServer = typeof body?.error === "string" && body.error ? body.error : null;
      setFailure({
        status: res.status,
        message:
          res.status === 409
            ? (fromServer ?? "A very similar line is already on your method sheet.")
            : (fromServer ?? `Something went wrong (${res.status}). Try again.`),
      });
    } catch {
      setFailure({ status: 0, message: "Couldn't reach the server. Check your connection and try again." });
    } finally {
      setBusy(null);
    }
  }

  const where = [line.unitNumber != null ? `Unit ${line.unitNumber}` : null, line.lecture].filter(Boolean).join(" · ");

  return (
    <section
      aria-label="Proposed method line"
      className={cn("bg-muted/30 space-y-3 rounded-lg border px-4 py-3.5", className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ListChecksIcon aria-hidden className="text-muted-foreground size-4" />
        <h4 className="text-xs font-semibold tracking-wide uppercase">New method line</h4>
        {where ? <span className="text-muted-foreground text-xs">{where}</span> : null}
        <Chip tone={outcome?.kind === "approved" ? "success" : outcome?.kind === "rejected" ? "neutral" : "warning"} className="ml-auto">
          {outcome?.kind === "approved" ? "Approved" : outcome?.kind === "rejected" ? "Dropped" : "Needs your OK"}
        </Chip>
      </div>

      <LineFields line={line} />

      {outcome?.kind === "approved" ? (
        <p role="status" className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-emerald-800 dark:text-emerald-300">
          <span className="inline-flex items-center gap-1.5">
            <CircleCheckIcon aria-hidden className="size-4" />
            Added to your method sheet. It will show up in your quiz.
          </span>
          <CardLink href="/methods">View method sheet</CardLink>
        </p>
      ) : outcome?.kind === "rejected" ? (
        <p role="status" className="text-muted-foreground inline-flex items-center gap-1.5 text-sm">
          <CircleXIcon aria-hidden className="size-4" />
          Dropped. It will not be added to your method sheet.
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button size="lg" onClick={() => decide("approve")} disabled={busy !== null} aria-busy={busy === "approve"}>
            {busy === "approve" ? <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" /> : <CheckIcon aria-hidden />}
            {busy === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button size="lg" variant="outline" onClick={() => decide("reject")} disabled={busy !== null} aria-busy={busy === "reject"}>
            {busy === "reject" ? <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" /> : <XIcon aria-hidden />}
            {busy === "reject" ? "Dropping…" : "Reject"}
          </Button>
          <span className="text-muted-foreground text-xs">Only approved lines join your quiz.</span>
        </div>
      )}

      {failure && !outcome ? (
        <p
          role="alert"
          className={cn(
            "flex items-start gap-2 rounded-md border px-3 py-2 text-sm",
            failure.status === 409
              ? "border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200"
              : "border-rose-200 bg-rose-50/70 text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200",
          )}
        >
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span className="text-pretty">
            {failure.status === 409 ? <DuplicateNote message={failure.message} /> : failure.message}
          </span>
        </p>
      ) : null}
    </section>
  );
}

function DuplicateNote({ message }: { message: string }) {
  const { lead, match } = describeDuplicate(message);
  return (
    <>
      <strong className="font-medium">{lead} </strong>
      {match ? <>It matches a line you already have: &ldquo;{match}&rdquo;. </> : <>{message} </>}
      You can reject this one instead.
    </>
  );
}

// ---------------------------------------------------------------------------
// Tool UIs for approving / rejecting from chat ("yes, approve it")
// ---------------------------------------------------------------------------

const ApprovedLineCard: ToolCallMessagePartComponent = (part) => {
  const state = resolveToolState(part);

  if (state.kind === "loading") {
    return (
      <ToolCard icon={<ListChecksIcon />} kicker="Method sheet">
        <ToolCardLoading label="Adding it to your method sheet" lines={2} />
      </ToolCard>
    );
  }
  if (state.kind === "error") {
    const duplicate = asNum(asRec(part.result)?.status) === 409;
    const match = duplicate ? describeDuplicate(state.message).match : null;
    return (
      <ToolCardError
        kicker="Method sheet"
        tone={duplicate ? "warning" : "danger"}
        title={duplicate ? "Looks like a duplicate" : "Couldn't add that line"}
        message={match ? `It matches a line you already have: “${match}”` : state.message}
        hint={duplicate ? "A very similar line is already on your sheet. You can reject this one." : undefined}
      />
    );
  }

  const line = readLine(state.data.line);
  return (
    <ToolCard tone="success" icon={<CircleCheckIcon />} kicker="Method sheet" aside={<Chip tone="success">Approved</Chip>}>
      <RecordOutcome id={line?.id ?? null} kind="approved" />
      <p className="font-medium">Added to your method sheet.</p>
      {line ? <LineFields line={line} /> : null}
      <CardLink href="/methods">View method sheet</CardLink>
    </ToolCard>
  );
};

const RejectedLineCard: ToolCallMessagePartComponent = (part) => {
  const state = resolveToolState(part);

  if (state.kind === "loading") {
    return (
      <ToolCard icon={<ListChecksIcon />} kicker="Method sheet">
        <ToolCardLoading label="Dropping that line" lines={1} />
      </ToolCard>
    );
  }
  if (state.kind === "error") {
    return <ToolCardError kicker="Method sheet" title="Couldn't drop that line" message={state.message} />;
  }

  const lineId = asStr(asRec(part.args)?.lineId);
  return (
    <ToolCard icon={<CircleXIcon />} kicker="Method sheet" aside={<Chip>Dropped</Chip>}>
      <RecordOutcome id={lineId} kind="rejected" />
      <p className="text-muted-foreground">Dropped. That line will not be added to your method sheet.</p>
    </ToolCard>
  );
};

export const ApproveMethodLineToolUI = makeAssistantToolUI({
  toolName: "approve_method_line",
  display: "standalone",
  render: ApprovedLineCard,
});

export const RejectMethodLineToolUI = makeAssistantToolUI({
  toolName: "reject_method_line",
  display: "standalone",
  render: RejectedLineCard,
});

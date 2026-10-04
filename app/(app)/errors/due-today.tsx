"use client";

import { useId, useState } from "react";
import type { FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ErrorLogEntry, Grade } from "@/lib/contracts";
import { DateText, Notice, api, messageOf } from "./parts";
import type { DueEntry } from "./parts";

/** "Due today": every problem whose re-drill date has come, each with its statement and an answer box. */

function Statement({ text }: { text: string }) {
  return (
    <blockquote className="border-l-2 border-border pl-3 text-sm leading-relaxed whitespace-pre-wrap">{text}</blockquote>
  );
}

function CardHeader({ entry }: { entry: DueEntry }) {
  return (
    <header className="space-y-1">
      <h3 className="text-base font-medium text-balance">{entry.problemLabel}</h3>
      <p className="text-xs text-muted-foreground">
        <span className="tabular-nums">Unit {entry.unitNumber}</span>
        {entry.lecture ? ` · ${entry.lecture}` : ""}
        {" · re-drill date "}
        <DateText iso={entry.redrillOn} />
      </p>
    </header>
  );
}

function DueCard({ entry, onGraded }: { entry: DueEntry; onGraded: (grade: Grade) => void }) {
  const fieldId = useId();
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = answer.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    setError(null);
    try {
      const grade = await api<Grade>(`/api/errors/${encodeURIComponent(entry.id)}/redrill`, {
        method: "POST",
        body: { answer: trimmed },
      });
      onGraded(grade);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  }

  return (
    <li className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground">
      <CardHeader entry={entry} />
      <Statement text={entry.statement} />
      <form onSubmit={submit} className="space-y-3">
        <div className="space-y-1.5">
          <label htmlFor={fieldId} className="text-sm font-medium">
            Your answer
          </label>
          <Textarea
            id={fieldId}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="Solve it again from scratch. Show the key steps, then the result."
            className="min-h-24"
            disabled={busy}
            required
          />
        </div>
        {error && <Notice tone="error" title="Could not grade that answer">{error}</Notice>}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy || !answer.trim()}>
            {busy ? (
              <>
                <LoaderCircle aria-hidden="true" className="animate-spin" />
                Checking
              </>
            ) : (
              "Check my answer"
            )}
          </Button>
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {busy ? "Grading your answer. This takes a few seconds." : ""}
          </span>
        </div>
      </form>
    </li>
  );
}

function AnsweredCard({
  entry,
  grade,
  nextDate,
  onDismiss,
}: {
  entry: DueEntry;
  grade: Grade;
  nextDate: string | null;
  onDismiss: () => void;
}) {
  return (
    <li className="space-y-4 rounded-xl border bg-card p-5 text-card-foreground">
      <CardHeader entry={entry} />
      {grade.passed ? (
        <Notice tone="success" title="Cleared">
          <p>{grade.feedback}</p>
          <p className="text-muted-foreground">This problem moved to your shuffle pile.</p>
        </Notice>
      ) : (
        <Notice tone="warning" title="Not yet">
          <p>{grade.feedback}</p>
          {nextDate && (
            <p className="text-muted-foreground">
              It comes back on <DateText iso={nextDate} />.
            </p>
          )}
        </Notice>
      )}
      <Button variant="outline" size="sm" onClick={onDismiss}>
        Dismiss
      </Button>
    </li>
  );
}

/** The rescheduled date, once the refreshed log has it (it is always later than the date that was due). */
function newerDate(next: string | undefined, due: string): string | null {
  return next && next > due ? next : null;
}

export function DueToday({
  due,
  entries,
  onChanged,
}: {
  due: DueEntry[];
  entries: ErrorLogEntry[];
  onChanged: () => void;
}) {
  // Once graded, a problem leaves the due list (cleared, or rescheduled), so keep its feedback here.
  const [answered, setAnswered] = useState<{ entry: DueEntry; grade: Grade }[]>([]);
  const answeredIds = new Set(answered.map((a) => a.entry.id));
  const waiting = due.filter((d) => !answeredIds.has(d.id));

  function graded(entry: DueEntry, grade: Grade) {
    setAnswered((list) => [...list.filter((a) => a.entry.id !== entry.id), { entry, grade }]);
    onChanged();
  }

  return (
    <section aria-labelledby="due-heading" className="space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="due-heading" className="text-lg font-semibold text-balance">
          Due today
        </h2>
        <span className="text-sm text-muted-foreground tabular-nums">
          {waiting.length === 0 ? "nothing waiting" : `${waiting.length} to re-drill`}
        </span>
      </div>

      {waiting.length === 0 && answered.length === 0 && (
        <div className="rounded-xl border border-dashed p-6 text-sm text-muted-foreground">
          Nothing to re-drill today. Problems come back here on their re-drill date: two days after a mistake in your
          current unit, a week after one from an earlier unit.
        </div>
      )}

      {waiting.length > 0 && (
        <ul className="space-y-4">
          {waiting.map((entry) => (
            <DueCard key={entry.id} entry={entry} onGraded={(grade) => graded(entry, grade)} />
          ))}
        </ul>
      )}

      {answered.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-muted-foreground">Just answered</h3>
          <ul className="space-y-4">
            {answered.map(({ entry, grade }) => (
              <AnsweredCard
                key={entry.id}
                entry={entry}
                grade={grade}
                nextDate={newerDate(entries.find((e) => e.id === entry.id)?.redrillOn, entry.redrillOn)}
                onDismiss={() => setAnswered((list) => list.filter((a) => a.entry.id !== entry.id))}
              />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

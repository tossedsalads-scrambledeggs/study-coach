"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent } from "react";
import { LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ErrorLogEntry, MethodLine } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { DateText, ErrorTypeChips, Field, Notice, api, messageOf } from "./parts";

/** Log a problem: a mistake (diagnosed, then drilled again) or one the student got right (shuffle pile). */

type Mode = "wrong" | "right";

type Result =
  | { kind: "wrong"; entry: ErrorLogEntry; pendingLine: MethodLine | null }
  | { kind: "right"; label: string };

function Label({ htmlFor, children, hint }: { htmlFor: string; children: string; hint?: string }) {
  return (
    <label htmlFor={htmlFor} className="block space-y-0.5 text-sm font-medium">
      <span>{children}</span>
      {hint && <span className="block text-xs font-normal text-muted-foreground">{hint}</span>}
    </label>
  );
}

function ModeOption({
  name,
  value,
  checked,
  onChange,
  children,
}: {
  name: string;
  value: Mode;
  checked: boolean;
  onChange: () => void;
  children: string;
}) {
  return (
    <label className="relative cursor-pointer">
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={onChange}
        className="peer sr-only"
      />
      <span
        className={cn(
          "inline-flex h-8 items-center rounded-lg border px-3 text-sm font-medium transition-colors",
          "peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground",
          "peer-focus-visible:ring-3 peer-focus-visible:ring-ring/50 hover:bg-muted peer-checked:hover:bg-primary",
        )}
      >
        {children}
      </span>
    </label>
  );
}

function Diagnosis({ entry, pendingLine }: { entry: ErrorLogEntry; pendingLine: MethodLine | null }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <h3 className="text-base font-medium text-balance">Logged: {entry.problemLabel}</h3>
        <ErrorTypeChips types={entry.errorTypes} primary={entry.primaryErrorType} />
      </div>
      <Field label="What went wrong">
        <p className="whitespace-pre-line">{entry.whatWentWrong}</p>
      </Field>
      <Field label="Correct approach">
        <p className="whitespace-pre-line">{entry.correctApproach}</p>
      </Field>
      <Field label="The fix">
        <p>{entry.lesson}</p>
      </Field>
      <p className="text-sm text-muted-foreground">
        You will re-drill this on <DateText iso={entry.redrillOn} className="font-medium text-foreground" />.
      </p>
      {pendingLine && (
        <div className="space-y-2 rounded-lg border border-dashed bg-background/60 p-4">
          <h4 className="text-sm font-medium">A method line was drafted for you</h4>
          <dl className="space-y-1 text-sm leading-relaxed">
            <div>
              <dt className="inline font-medium">Trigger: </dt>
              <dd className="inline">{pendingLine.trigger}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Move: </dt>
              <dd className="inline">{pendingLine.move}</dd>
            </div>
            <div>
              <dt className="inline font-medium">Trap: </dt>
              <dd className="inline">{pendingLine.trap}</dd>
            </div>
          </dl>
          <p className="text-xs text-muted-foreground">
            It stays pending until you approve it on the{" "}
            <Link href="/methods" className="font-medium underline underline-offset-4 hover:text-foreground">
              method sheet
            </Link>
            .
          </p>
        </div>
      )}
    </div>
  );
}

export function LogMistakeForm({
  defaultUnit,
  onLogged,
}: {
  defaultUnit: number | null;
  onLogged: () => void;
}) {
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;

  const [mode, setMode] = useState<Mode>("wrong");
  const [label, setLabel] = useState("");
  const [statement, setStatement] = useState("");
  const [unit, setUnit] = useState("");
  const [lecture, setLecture] = useState("");
  const [answer, setAnswer] = useState("");
  const [approach, setApproach] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // Start on the unit the student is in, unless they have already typed one.
  useEffect(() => {
    if (defaultUnit != null) setUnit((current) => (current === "" ? String(defaultUnit) : current));
  }, [defaultUnit]);

  // Move focus to the outcome so keyboard and screen reader users land on it.
  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    const unitNumber = Number(unit);
    if (!label.trim() || !statement.trim()) {
      setError("Add a label and the problem statement.");
      return;
    }
    if (!Number.isInteger(unitNumber) || unitNumber < 1) {
      setError("Unit number must be a whole number, 1 or higher.");
      return;
    }
    if (mode === "wrong" && !approach.trim()) {
      setError("Describe your approach so the coach can find where it went wrong.");
      return;
    }

    setBusy(true);
    setError(null);
    setResult(null);
    const problem = {
      label: label.trim(),
      statement: statement.trim(),
      unitNumber,
      lecture: lecture.trim() || null,
      answer: answer.trim() || null,
    };
    try {
      if (mode === "wrong") {
        const { entry, pendingLine } = await api<{ entry: ErrorLogEntry; pendingLine: MethodLine | null }>(
          "/api/errors",
          { method: "POST", body: { ...problem, studentApproach: approach.trim() } },
        );
        setResult({ kind: "wrong", entry, pendingLine });
      } else {
        await api<{ problemId: string }>("/api/problems/correct", { method: "POST", body: problem });
        setResult({ kind: "right", label: problem.label });
      }
      setLabel("");
      setStatement("");
      setAnswer("");
      setApproach("");
      onLogged();
    } catch (err) {
      setError(messageOf(err));
    } finally {
      setBusy(false);
    }
  }

  const wrong = mode === "wrong";

  return (
    <section aria-labelledby="log-heading" className="space-y-4">
      <div className="space-y-1">
        <h2 id="log-heading" className="text-lg font-semibold text-balance">
          Log a problem
        </h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          {wrong
            ? "Paste a problem you got wrong and how you went at it. The coach finds where it went off, writes the fix, and schedules a re-drill."
            : "Got one right? Log it and it goes to your shuffle pile, where you get a fresh variation of it later."}
        </p>
      </div>

      <form onSubmit={submit} className="space-y-5 rounded-xl border bg-card p-5 text-card-foreground">
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">How did it go?</legend>
          <div className="flex flex-wrap gap-2">
            <ModeOption name={id("mode")} value="wrong" checked={wrong} onChange={() => setMode("wrong")}>
              I got it wrong
            </ModeOption>
            <ModeOption name={id("mode")} value="right" checked={!wrong} onChange={() => setMode("right")}>
              I got this right
            </ModeOption>
          </div>
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="space-y-1.5">
            <Label htmlFor={id("label")}>Label</Label>
            <Input
              id={id("label")}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Ex 4 - Sample Space, part 1"
              required
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("unit")}>Unit number</Label>
            <Input
              id={id("unit")}
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder="e.g. 3"
              className="tabular-nums"
              required
              disabled={busy}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={id("lecture")}>Lecture</Label>
            <Input
              id={id("lecture")}
              value={lecture}
              onChange={(e) => setLecture(e.target.value)}
              placeholder="e.g. Lec 7"
              disabled={busy}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor={id("statement")}>Problem statement</Label>
          <Textarea
            id={id("statement")}
            value={statement}
            onChange={(e) => setStatement(e.target.value)}
            placeholder="Paste the problem exactly as it was asked."
            className="min-h-24"
            required
            disabled={busy}
          />
        </div>

        {wrong && (
          <div className="space-y-1.5">
            <Label htmlFor={id("approach")} hint="What you did, step by step, and the answer you got.">
              Your approach
            </Label>
            <Textarea
              id={id("approach")}
              value={approach}
              onChange={(e) => setApproach(e.target.value)}
              placeholder="e.g. I added the two variances: 4 + 9 = 13."
              className="min-h-24"
              required
              disabled={busy}
            />
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor={id("answer")} hint="Optional. The answer key or the right result, if you have it.">
            Correct answer
          </Label>
          <Input
            id={id("answer")}
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            placeholder="e.g. Var(X + Y) = 17"
            disabled={busy}
          />
        </div>

        {error && <Notice tone="error">{error}</Notice>}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" size="lg" disabled={busy}>
            {busy ? (
              <>
                <LoaderCircle aria-hidden="true" className="animate-spin" />
                {wrong ? "Reading your approach" : "Saving"}
              </>
            ) : wrong ? (
              "Find my mistake"
            ) : (
              "Save to shuffle pile"
            )}
          </Button>
          <span aria-live="polite" className="text-xs text-muted-foreground">
            {busy && wrong ? "The coach is working through it. This takes a few seconds." : ""}
          </span>
        </div>
      </form>

      <div ref={resultRef} tabIndex={-1} className="outline-none" aria-live="polite">
        {result?.kind === "wrong" && (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-5 dark:border-emerald-500/30 dark:bg-emerald-500/5">
            <Diagnosis entry={result.entry} pendingLine={result.pendingLine} />
          </div>
        )}
        {result?.kind === "right" && (
          <Notice tone="success" title={`Saved: ${result.label}`}>
            <p>It is in your shuffle pile now. You will get a new, similar problem to try later.</p>
          </Notice>
        )}
      </div>
    </section>
  );
}

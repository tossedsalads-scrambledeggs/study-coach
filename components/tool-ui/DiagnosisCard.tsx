"use client";

import { makeAssistantToolUI, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { CalendarClockIcon, CircleCheckIcon, LightbulbIcon, NotebookPenIcon, StethoscopeIcon } from "lucide-react";
import { ERROR_TYPE_LABELS, type ErrorType } from "@/lib/contracts";
import { MethodLineApprovalCard, readLine } from "./MethodLineApprovalCard";
import {
  asNum,
  asRec,
  asStr,
  CardLink,
  Chip,
  ContinueButton,
  Field,
  formatDay,
  resolveToolState,
  ToolCard,
  ToolCardEmpty,
  ToolCardError,
  ToolCardLoading,
} from "./shared";

const KICKER = "Diagnosis";

const typeLabel = (t: string): string => ERROR_TYPE_LABELS[t as ErrorType] ?? t.replace(/_/g, " ");

export const DiagnosisCard: ToolCallMessagePartComponent = (part) => {
  const state = resolveToolState(part);

  if (state.kind === "loading") {
    const label = asStr(asRec(part.args)?.label);
    return (
      <ToolCard icon={<StethoscopeIcon />} kicker={KICKER}>
        <ToolCardLoading label={label ? `Working out what went wrong on ${label}` : "Working out what went wrong"} lines={4} />
      </ToolCard>
    );
  }
  if (state.kind === "error") {
    return <ToolCardError kicker={KICKER} title="Couldn't log that mistake" message={state.message} hint="Nothing was saved. Ask the coach to try again." />;
  }

  const entry = asRec(state.data.entry);
  if (!entry) {
    return (
      <ToolCard icon={<StethoscopeIcon />} kicker={KICKER}>
        <ToolCardEmpty title="No diagnosis came back">
          <p>Ask the coach to log it again.</p>
        </ToolCardEmpty>
      </ToolCard>
    );
  }

  const wentWrong = asStr(entry.whatWentWrong);
  const correct = asStr(entry.correctApproach);
  const lesson = asStr(entry.lesson);
  const redrill = formatDay(asStr(entry.redrillOn));
  const label = asStr(entry.problemLabel);
  const unit = asNum(entry.unitNumber);
  const lecture = asStr(entry.lecture);

  const primary = asStr(entry.primaryErrorType);
  const types = Array.isArray(entry.errorTypes) ? entry.errorTypes.filter((t): t is string => typeof t === "string") : [];
  const ordered = primary ? [primary, ...types.filter((t) => t !== primary)] : types;

  const pendingLine = readLine(state.data.pendingLine);
  const slipOnly = ordered.length > 0 && ordered.every((t) => t === "computational_slip");

  const where = [unit != null ? `Unit ${unit}` : null, lecture].filter(Boolean).join(" · ");

  return (
    <ToolCard
      icon={<StethoscopeIcon />}
      kicker={KICKER}
      label={label ? `Diagnosis for ${label}` : "Diagnosis"}
      aside={where ? <Chip>{where}</Chip> : null}
    >
      {label ? <p className="text-foreground text-[1.05rem] leading-snug font-medium text-balance">{label}</p> : null}

      {ordered.length > 0 ? (
        <ul aria-label="Error types" className="flex flex-wrap gap-2">
          {ordered.map((t) => {
            const isPrimary = t === primary;
            return (
              <li key={t}>
                <Chip tone={isPrimary ? "strong" : "neutral"} title={isPrimary ? "Main cause" : "Also applies"}>
                  {typeLabel(t)}
                  <span className="sr-only">{isPrimary ? " (main cause)" : " (also applies)"}</span>
                </Chip>
              </li>
            );
          })}
        </ul>
      ) : null}

      <dl className="space-y-4">
        {wentWrong ? <Field label="What went wrong">{wentWrong}</Field> : null}
        {correct ? <Field label="The correct approach">{correct}</Field> : null}
      </dl>

      {lesson ? (
        <div className="flex gap-2.5 rounded-lg border border-amber-200 bg-amber-50/70 px-3.5 py-3 dark:border-amber-900 dark:bg-amber-950/40">
          <LightbulbIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-amber-700 dark:text-amber-300" />
          <div className="space-y-0.5">
            <p className="text-xs font-medium tracking-wide text-amber-800 uppercase dark:text-amber-300">The fix</p>
            <p className="text-pretty">{lesson}</p>
          </div>
        </div>
      ) : null}

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-5 gap-y-2 border-t pt-3 text-sm">
        {redrill ? (
          <p className="text-foreground inline-flex items-center gap-1.5 font-medium">
            <CalendarClockIcon aria-hidden className="size-4" />
            Re-drill on <span className="tabular-nums">{redrill}</span>
          </p>
        ) : null}
        <p className="inline-flex items-center gap-1.5">
          <CircleCheckIcon aria-hidden className="size-4" />
          Saved to your error log
        </p>
        <CardLink href="/errors">Open error log</CardLink>
        <span className="ml-auto">
          <ContinueButton prompt="I have another problem to log.">Log another</ContinueButton>
        </span>
      </div>

      {pendingLine ? (
        <MethodLineApprovalCard line={pendingLine} />
      ) : slipOnly ? (
        <p className="text-muted-foreground text-sm">A pure computational slip, so no new method line this time.</p>
      ) : null}
    </ToolCard>
  );
};

export const DiagnosisToolUI = makeAssistantToolUI({
  toolName: "log_error",
  display: "standalone",
  render: DiagnosisCard,
});

// ---------------------------------------------------------------------------
// log_correct_problem: a problem the student got right, saved for the shuffle pile
// ---------------------------------------------------------------------------

const CorrectProblemCard: ToolCallMessagePartComponent = (part) => {
  const state = resolveToolState(part);
  const args = asRec(part.args);
  const label = asStr(args?.label);
  const unit = asNum(args?.unitNumber);

  if (state.kind === "loading") {
    return (
      <ToolCard icon={<NotebookPenIcon />} kicker="Shuffle pile">
        <ToolCardLoading label="Saving it to your shuffle pile" lines={1} />
      </ToolCard>
    );
  }
  if (state.kind === "error") {
    return <ToolCardError kicker="Shuffle pile" title="Couldn't save that problem" message={state.message} hint="Nothing was saved. Ask the coach to try again." />;
  }

  return (
    <ToolCard
      tone="success"
      icon={<NotebookPenIcon />}
      kicker="Shuffle pile"
      aside={unit != null ? <Chip>Unit {unit}</Chip> : null}
    >
      <p className="font-medium">{label ? `Saved ${label} to your shuffle pile.` : "Saved to your shuffle pile."}</p>
      <p className="text-muted-foreground text-sm">It will come back later as a fresh problem that uses the same method.</p>
      <CardLink href="/shuffle">Open shuffle pile</CardLink>
    </ToolCard>
  );
};

export const CorrectProblemToolUI = makeAssistantToolUI({
  toolName: "log_correct_problem",
  display: "standalone",
  render: CorrectProblemCard,
});

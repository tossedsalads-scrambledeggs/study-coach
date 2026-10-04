"use client";

import { useEffect } from "react";
import {
  makeAssistantToolUI,
  type ToolCallMessagePartComponent,
  type ToolCallMessagePartProps,
} from "@assistant-ui/react";
import { CircleCheckIcon, CircleXIcon, ClipboardListIcon } from "lucide-react";
import {
  asNum,
  asRec,
  asStr,
  CardLink,
  Chip,
  ContinueButton,
  Field,
  resolveToolState,
  ToolCard,
  ToolCardError,
  ToolCardLoading,
} from "./shared";

/** Sent on `window` when a grade lands, so progress panels (the quiz tracker) can refresh. */
export const PROGRESS_EVENT = "coach:progress";

type Variant = "quiz" | "shuffle";

const COPY: Record<Variant, { kicker: string; loading: string; failTitle: string }> = {
  quiz: { kicker: "Your grade", loading: "Grading your answer", failTitle: "Couldn't grade that answer" },
  shuffle: { kicker: "Your grade", loading: "Checking your answer", failTitle: "Couldn't check that answer" },
};

export function GradeCard({ variant, ...part }: ToolCallMessagePartProps & { variant: Variant }) {
  const state = resolveToolState(part);
  const ready = state.kind === "ready";

  useEffect(() => {
    if (ready) window.dispatchEvent(new Event(PROGRESS_EVENT));
  }, [ready]);

  const copy = COPY[variant];

  if (state.kind === "loading") {
    return (
      <ToolCard icon={<CircleCheckIcon />} kicker={copy.kicker}>
        <ToolCardLoading label={copy.loading} lines={2} />
      </ToolCard>
    );
  }
  if (state.kind === "error") {
    return <ToolCardError kicker={copy.kicker} title={copy.failTitle} message={state.message} />;
  }

  const passed = state.data.passed;
  const feedback = asStr(state.data.feedback);
  if (typeof passed !== "boolean") {
    return (
      <ToolCardError kicker={copy.kicker} title="The grade came back unreadable" hint="Send your answer again and the coach will retry." />
    );
  }

  const line = asRec(state.data.line);
  const trigger = line ? asStr(line.trigger) : null;
  const move = line ? asStr(line.move) : null;
  const trap = line ? asStr(line.trap) : null;
  const lineUnit = line ? asNum(line.unitNumber) : null;
  const errorLogId = asStr(state.data.errorLogId);

  return (
    <ToolCard
      tone={passed ? "success" : "warning"}
      icon={passed ? <CircleCheckIcon /> : <CircleXIcon />}
      kicker={copy.kicker}
      label={passed ? "Graded: passed" : "Graded: not quite"}
      aside={
        <>
          {lineUnit != null ? <Chip>Unit {lineUnit}</Chip> : null}
          <Chip tone={passed ? "success" : "warning"}>{passed ? "Passed" : "Not quite"}</Chip>
        </>
      }
    >
      {feedback ? <p className="text-foreground text-pretty whitespace-pre-wrap">{feedback}</p> : null}

      {trigger || move || trap ? (
        <dl className="bg-muted/30 space-y-3 rounded-lg border px-3.5 py-3 text-sm">
          {trigger ? <Field label="When you see it">{trigger}</Field> : null}
          {move ? <Field label="The move">{move}</Field> : null}
          {trap ? (
            <div className="space-y-1 rounded-md border border-amber-200 bg-amber-50/70 px-3 py-2 dark:border-amber-900 dark:bg-amber-950/40">
              <dt className="text-xs font-medium tracking-wide text-amber-800 uppercase dark:text-amber-300">The trap</dt>
              <dd className="text-pretty whitespace-pre-wrap">{trap}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-2 border-t pt-3 text-sm">
        {variant === "quiz" ? (
          <p>{passed ? "Passed once, so this line is retired from your quiz." : "This line stays in your quiz until you pass it."}</p>
        ) : passed ? (
          <p>Fully cleared. This problem leaves your shuffle pile.</p>
        ) : errorLogId ? (
          <>
            <p className="inline-flex items-center gap-1.5">
              <ClipboardListIcon aria-hidden className="size-4" />
              Added to your error log for a re-drill.
            </p>
            <CardLink href="/errors">Open error log</CardLink>
          </>
        ) : (
          <p>It stays in your shuffle pile for another try.</p>
        )}
        <span className="ml-auto">
          <ContinueButton prompt={variant === "quiz" ? "Next question, please." : "Next problem, please."}>
            {variant === "quiz" ? "Next question" : "Next problem"}
          </ContinueButton>
        </span>
      </div>
    </ToolCard>
  );
}

const QuizGradeCard: ToolCallMessagePartComponent = (part) => <GradeCard variant="quiz" {...part} />;
const ShuffleGradeCard: ToolCallMessagePartComponent = (part) => <GradeCard variant="shuffle" {...part} />;

export const QuizGradeToolUI = makeAssistantToolUI({
  toolName: "grade_quiz_answer",
  display: "standalone",
  render: QuizGradeCard,
});

export const ShuffleGradeToolUI = makeAssistantToolUI({
  toolName: "grade_shuffle_answer",
  display: "standalone",
  render: ShuffleGradeCard,
});

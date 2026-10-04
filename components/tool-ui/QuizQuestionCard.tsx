"use client";

import { makeAssistantToolUI, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { BrainIcon } from "lucide-react";
import { asNum, asRec, asStr, Chip, CardLink, resolveToolState, ToolCard, ToolCardEmpty, ToolCardError, ToolCardLoading } from "./shared";

const KICKER = "Method quiz";

/** `{ question: { methodLineId, unitNumber, question } }`, tolerating a flat `{ question, unitNumber }` too. */
function readQuestion(data: Record<string, unknown>): { text: string; unit: number | null } | null {
  const q = data.question;
  if (typeof q === "string" && q.trim()) return { text: q, unit: asNum(data.unitNumber) };
  const rec = asRec(q);
  const text = rec ? asStr(rec.question) : null;
  return text && rec ? { text, unit: asNum(rec.unitNumber) } : null;
}

export const QuizQuestionCard: ToolCallMessagePartComponent = (part) => {
  const state = resolveToolState(part);

  if (state.kind === "loading") {
    return (
      <ToolCard icon={<BrainIcon />} kicker={KICKER}>
        <ToolCardLoading label="Picking a fresh scenario" lines={3} />
      </ToolCard>
    );
  }
  if (state.kind === "error") {
    return <ToolCardError kicker={KICKER} title="Couldn't get a question" message={state.message} />;
  }

  if (state.data.done === true) {
    return (
      <ToolCard tone="success" icon={<BrainIcon />} kicker={KICKER}>
        <ToolCardEmpty title="You've passed every method line in reach">
          <p>Nothing left to quiz right now. New lines show up when you log a mistake or reach a new unit.</p>
        </ToolCardEmpty>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <CardLink href="/log">Log a mistake</CardLink>
          <CardLink href="/shuffle">Try the shuffle pile</CardLink>
        </div>
      </ToolCard>
    );
  }

  const question = readQuestion(state.data);
  if (!question) {
    return (
      <ToolCard icon={<BrainIcon />} kicker={KICKER}>
        <ToolCardEmpty title="No question came back">
          <p>Ask the coach for another one.</p>
        </ToolCardEmpty>
      </ToolCard>
    );
  }

  return (
    <ToolCard
      icon={<BrainIcon />}
      kicker={KICKER}
      label="Quiz question"
      aside={question.unit != null ? <Chip>Unit {question.unit}</Chip> : null}
    >
      <p className="text-foreground text-[1.05rem] leading-relaxed font-medium text-pretty whitespace-pre-wrap">
        {question.text}
      </p>
      <p className="text-muted-foreground border-t pt-3 text-sm">
        <span className="text-foreground font-medium">Your move.</span> Say what you would do, in your own words.
      </p>
    </ToolCard>
  );
};

export const QuizQuestionToolUI = makeAssistantToolUI({
  toolName: "next_quiz_question",
  display: "standalone",
  render: QuizQuestionCard,
});

"use client";

import { makeAssistantToolUI, type ToolCallMessagePartComponent } from "@assistant-ui/react";
import { ShuffleIcon } from "lucide-react";
import { asStr, CardLink, Chip, resolveToolState, ToolCard, ToolCardEmpty, ToolCardError, ToolCardLoading } from "./shared";

const KICKER = "Shuffle pile";

export const ShuffleProblemCard: ToolCallMessagePartComponent = (part) => {
  const state = resolveToolState(part);

  if (state.kind === "loading") {
    return (
      <ToolCard icon={<ShuffleIcon />} kicker={KICKER}>
        <ToolCardLoading label="Writing a new problem for you" lines={4} />
      </ToolCard>
    );
  }
  if (state.kind === "error") {
    return <ToolCardError kicker={KICKER} title="Couldn't get a problem" message={state.message} />;
  }

  if (state.data.done === true) {
    return (
      <ToolCard icon={<ShuffleIcon />} kicker={KICKER}>
        <ToolCardEmpty title="Your shuffle pile is empty for now">
          <p>Problems you clear, and ones you log as &ldquo;got it right&rdquo;, show up here as fresh variants.</p>
        </ToolCardEmpty>
        <CardLink href="/log">Log a problem</CardLink>
      </ToolCard>
    );
  }

  const statement = asStr(state.data.statement);
  if (!statement) {
    return (
      <ToolCard icon={<ShuffleIcon />} kicker={KICKER}>
        <ToolCardEmpty title="No problem came back">
          <p>Ask the coach for another one.</p>
        </ToolCardEmpty>
      </ToolCard>
    );
  }

  return (
    <ToolCard
      icon={<ShuffleIcon />}
      kicker={KICKER}
      label="Shuffle problem"
      aside={<Chip>Same method, new surface</Chip>}
    >
      <p className="text-foreground text-[1.05rem] leading-relaxed text-pretty whitespace-pre-wrap">{statement}</p>
      <p className="text-muted-foreground border-t pt-3 text-sm">
        <span className="text-foreground font-medium">Your move.</span> Work it out, then type your answer below.
      </p>
    </ToolCard>
  );
};

export const ShuffleProblemToolUI = makeAssistantToolUI({
  toolName: "next_shuffle_problem",
  display: "standalone",
  render: ShuffleProblemCard,
});

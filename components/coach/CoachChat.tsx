"use client";

import { useMemo, useState, type FC } from "react";
import { AssistantRuntimeProvider, ThreadPrimitive } from "@assistant-ui/react";
import { AssistantChatTransport, useChatRuntime } from "@assistant-ui/ai-sdk";
import { ArrowUpRightIcon, BrainIcon, NotebookPenIcon, RotateCcwIcon, ShuffleIcon, type LucideIcon } from "lucide-react";
import { CoachThread } from "./CoachThread";
import { LogToolUIs, QuizToolUIs, ShuffleToolUIs } from "@/components/tool-ui";
import { Button } from "@/components/ui/button";

export type CoachMode = "quiz" | "log" | "shuffle";

type Suggestion = { text: string; prompt: string };

type ModeCopy = {
  icon: LucideIcon;
  title: string;
  blurb: string;
  greetingTitle: string;
  greeting: string;
  suggestions: Suggestion[];
  placeholder: string;
  ToolUIs: FC;
};

const MODE_COPY: Record<CoachMode, ModeCopy> = {
  quiz: {
    icon: BrainIcon,
    title: "Method quiz",
    blurb: "A fresh scenario each time. You say the move; I grade it.",
    greetingTitle: "Ready for a method check?",
    greeting:
      "I'll give you a short scenario from one of your method lines. Tell me what you would do, in your own words, and I'll grade it. One pass retires the line.",
    suggestions: [{ text: "Quiz me on a method", prompt: "Quiz me on a method." }],
    placeholder: "Your move: what would you do?",
    ToolUIs: QuizToolUIs,
  },
  log: {
    icon: NotebookPenIcon,
    title: "Log a mistake",
    blurb: "Paste a problem and what you tried. I find where it went off track.",
    greetingTitle: "What got you stuck?",
    greeting:
      "Tell me about a problem you got wrong: the problem itself, which unit it is from, the lecture if you know it, and what you tried. I'll find where it went off track and set a re-drill date.",
    suggestions: [
      { text: "I got a problem wrong. Help me log it", prompt: "I got a problem wrong and want to log it." },
      { text: "I got one right and want to practice it again later", prompt: "I got a problem right and want to add it to my shuffle pile." },
    ],
    placeholder: "Paste the problem, its unit, and what you tried",
    ToolUIs: LogToolUIs,
  },
  shuffle: {
    icon: ShuffleIcon,
    title: "Shuffle pile",
    blurb: "New problems with the same method, so you can't just recognize the old one.",
    greetingTitle: "Same method, new surface.",
    greeting:
      "Problems you've cleared come back here in a new form. Solve it, tell me your answer, and I'll check it. If you miss one, it goes back to your error log.",
    suggestions: [{ text: "Give me a shuffle problem", prompt: "Give me a shuffle problem." }],
    placeholder: "Your answer",
    ToolUIs: ShuffleToolUIs,
  },
};

const CoachWelcome: FC<{ mode: CoachMode }> = ({ mode }) => {
  const copy = MODE_COPY[mode];
  const Icon = copy.icon;
  return (
    <div className="aui-coach-welcome fade-in slide-in-from-bottom-1 animate-in fill-mode-both mb-6 space-y-5 px-2 duration-200">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="bg-primary text-primary-foreground mt-0.5 grid size-9 shrink-0 place-items-center rounded-full"
        >
          <Icon className="size-4" />
        </span>
        <div className="min-w-0 space-y-1.5">
          <p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">Your coach</p>
          <p className="text-xl font-semibold tracking-tight text-balance">{copy.greetingTitle}</p>
          <p className="text-muted-foreground max-w-prose text-[0.95rem] leading-relaxed text-pretty">{copy.greeting}</p>
        </div>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap" role="group" aria-label="Suggested first message">
        {copy.suggestions.map((s) => (
          <ThreadPrimitive.Suggestion
            key={s.prompt}
            prompt={s.prompt}
            send
            className="border-foreground/15 bg-card hover:border-foreground/30 hover:bg-muted/60 focus-visible:ring-ring/50 group inline-flex items-center justify-between gap-3 rounded-xl border px-4 py-2.5 text-start text-sm font-medium shadow-xs transition-colors outline-none focus-visible:ring-2 motion-reduce:transition-none"
          >
            <span className="text-pretty">{s.text}</span>
            <ArrowUpRightIcon
              aria-hidden
              className="text-muted-foreground group-hover:text-foreground size-4 shrink-0 transition-colors"
            />
          </ThreadPrimitive.Suggestion>
        ))}
      </div>
    </div>
  );
};

// One stable component per mode: the thread reads these through props.
const WELCOME: Record<CoachMode, FC> = {
  quiz: () => <CoachWelcome mode="quiz" />,
  log: () => <CoachWelcome mode="log" />,
  shuffle: () => <CoachWelcome mode="shuffle" />,
};

function CoachSession({ mode }: { mode: CoachMode }) {
  const transport = useMemo(
    () => new AssistantChatTransport({ api: "/api/chat", body: { mode } }),
    [mode],
  );
  // Every tool runs on the server, so the client never needs to send tool results back.
  const runtime = useChatRuntime({ transport });
  const { ToolUIs, placeholder } = MODE_COPY[mode];

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ToolUIs />
      <CoachThread Welcome={WELCOME[mode]} placeholder={placeholder} />
    </AssistantRuntimeProvider>
  );
}

/** A coach chat for one mode: its own runtime, system prompt (server side) and tool cards. */
export function CoachChat({ mode }: { mode: CoachMode }) {
  const copy = MODE_COPY[mode];
  const Icon = copy.icon;
  const [session, setSession] = useState(0);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-3 border-b px-4 py-3 sm:px-6">
        <span aria-hidden className="bg-muted text-foreground grid size-8 shrink-0 place-items-center rounded-lg">
          <Icon className="size-4" />
        </span>
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight text-balance">{copy.title}</h1>
          <p className="text-muted-foreground truncate text-sm">{copy.blurb}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="ml-auto shrink-0"
          onClick={() => setSession((n) => n + 1)}
          aria-label="Start a new session"
        >
          <RotateCcwIcon aria-hidden />
          <span className="hidden sm:inline">New session</span>
        </Button>
      </div>
      <div className="min-h-0 flex-1 [&>*]:h-full">
        <CoachSession key={session} mode={mode} />
      </div>
    </div>
  );
}

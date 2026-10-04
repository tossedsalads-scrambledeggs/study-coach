import type { Metadata } from "next";
import { CoachChat } from "@/components/coach/CoachChat";
import { QuizTracker } from "@/components/coach/QuizTracker";

export const metadata: Metadata = { title: "Method quiz · Study Coach" };

export default function QuizPage() {
  return (
    <div className="flex h-full min-h-0 flex-col lg:flex-row">
      <aside
        aria-label="Quiz progress"
        className="bg-muted/20 shrink-0 border-b lg:order-last lg:w-72 lg:overflow-y-auto lg:border-b-0 lg:border-l"
      >
        <QuizTracker />
      </aside>
      <div className="min-h-0 min-w-0 flex-1">
        <CoachChat mode="quiz" />
      </div>
    </div>
  );
}

"use client";

import { Check } from "lucide-react";
import type { ErrorLogEntry } from "@/lib/contracts";
import { cn } from "@/lib/utils";
import { ClampedText, DateText, ErrorTypeChips } from "./parts";

/** The error log as a table, every column from the plan, newest first. */

const COLUMNS: { label: string; className?: string }[] = [
  { label: "Date" },
  { label: "Week / Unit" },
  { label: "Lecture" },
  { label: "Problem", className: "min-w-36" },
  { label: "What I got wrong", className: "min-w-52" },
  { label: "Correct approach", className: "min-w-56" },
  { label: "Error type" },
  { label: "Fix / lesson", className: "min-w-44" },
  { label: "Re-drill date" },
  { label: "Cleared?" },
  { label: "Cleared on" },
];

export function ErrorTable({ entries, dueIds }: { entries: ErrorLogEntry[]; dueIds: Set<string> }) {
  return (
    <div
      role="region"
      aria-label="Error log table, scrolls sideways on narrow screens"
      tabIndex={0}
      className="overflow-x-auto rounded-xl border outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      <table className="w-full min-w-[1100px] border-collapse text-sm">
        <caption className="sr-only">
          Every mistake you logged, newest first, with the diagnosis and when it comes back for a re-drill.
        </caption>
        <thead>
          <tr className="border-b bg-muted/60 text-left">
            {COLUMNS.map((c) => (
              <th
                key={c.label}
                scope="col"
                className={cn(
                  "px-2.5 py-2.5 text-xs font-medium tracking-wide whitespace-nowrap text-muted-foreground uppercase",
                  c.className,
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y">
          {entries.map((e) => (
            <tr key={e.id} className="align-top">
              <td className="px-2.5 py-3 whitespace-nowrap">
                <DateText iso={e.loggedOn} />
              </td>
              <td className="px-2.5 py-3 whitespace-nowrap tabular-nums">
                <div>{e.weekNumber != null ? `Wk ${e.weekNumber}` : "Wk –"}</div>
                <div className="text-muted-foreground">Unit {e.unitNumber}</div>
              </td>
              <td className="px-2.5 py-3">{e.lecture ?? <span className="text-muted-foreground">–</span>}</td>
              <td className="px-2.5 py-3 font-medium">{e.problemLabel}</td>
              <td className="px-2.5 py-3 leading-relaxed">
                <ClampedText text={e.whatWentWrong} />
              </td>
              <td className="px-2.5 py-3 leading-relaxed">
                <ClampedText text={e.correctApproach} />
              </td>
              <td className="px-2.5 py-3">
                <ErrorTypeChips types={e.errorTypes} primary={e.primaryErrorType} />
              </td>
              <td className="px-2.5 py-3 leading-relaxed">{e.lesson}</td>
              <td className="px-2.5 py-3 whitespace-nowrap">
                <div className="flex flex-col items-start gap-1">
                  <DateText iso={e.redrillOn} />
                  {!e.cleared && dueIds.has(e.id) && (
                    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-200">
                      Due now
                    </span>
                  )}
                </div>
              </td>
              <td className="px-2.5 py-3 whitespace-nowrap">
                {e.cleared ? (
                  <span className="inline-flex items-center gap-1 font-medium text-emerald-700 dark:text-emerald-300">
                    <Check aria-hidden="true" className="size-4" />
                    Yes
                  </span>
                ) : (
                  <span className="text-muted-foreground">Not yet</span>
                )}
              </td>
              <td className="px-2.5 py-3 whitespace-nowrap">
                <DateText iso={e.clearedOn} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

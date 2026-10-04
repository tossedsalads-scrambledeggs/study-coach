"use client";

import { useState } from "react";
import type { ReactNode } from "react";
import { CircleAlert, CircleCheck, Info } from "lucide-react";
import { ERROR_TYPE_LABELS } from "@/lib/contracts";
import type { ErrorLogEntry, ErrorType } from "@/lib/contracts";
import { cn } from "@/lib/utils";

/** Small pieces shared by the error log page: fetch helper, dates, error-type chips, notices. */

export type DueEntry = ErrorLogEntry & { statement: string };

/** What the service throws when there is no course to attach mistakes to. */
export const NO_COURSE_MESSAGE = "No course yet";

export function messageOf(err: unknown): string {
  return err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.";
}

/** Call one of the JSON routes. Throws an Error carrying the route's `{error}` message. */
export async function api<T>(url: string, init: { method?: "GET" | "POST"; body?: unknown } = {}): Promise<T> {
  const hasBody = init.body !== undefined;
  const res = await fetch(url, {
    method: init.method ?? "GET",
    cache: "no-store",
    headers: hasBody ? { "content-type": "application/json" } : undefined,
    body: hasBody ? JSON.stringify(init.body) : undefined,
  });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // not JSON; fall through to the status message
  }
  if (!res.ok) {
    const fromRoute =
      data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string"
        ? (data as { error: string }).error
        : null;
    throw new Error(fromRoute ?? `Request failed (${res.status})`);
  }
  return data as T;
}

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const fullFormat = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** "2026-10-04" -> "Oct 4" (with the year when it is not this year). Calendar dates: no timezone shifting. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "–";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.getUTCFullYear() === new Date().getFullYear() ? dayFormat.format(d) : fullFormat.format(d);
}

export function DateText({ iso, className }: { iso: string | null | undefined; className?: string }) {
  if (!iso) return <span className={cn("text-muted-foreground", className)}>–</span>;
  return (
    <time dateTime={iso} className={cn("tabular-nums", className)}>
      {formatDate(iso)}
    </time>
  );
}

const TYPE_STYLES: Record<ErrorType, string> = {
  concept_gap:
    "bg-violet-100 text-violet-900 ring-violet-300/70 dark:bg-violet-500/15 dark:text-violet-200 dark:ring-violet-400/30",
  computational_slip:
    "bg-sky-100 text-sky-900 ring-sky-300/70 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-400/30",
  wrong_tool:
    "bg-amber-100 text-amber-900 ring-amber-300/70 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-400/30",
  misread_setup:
    "bg-rose-100 text-rose-900 ring-rose-300/70 dark:bg-rose-500/15 dark:text-rose-200 dark:ring-rose-400/30",
};

/** Every error type that applies, readable labels, the main one first and marked with a dot. */
export function ErrorTypeChips({ types, primary }: { types: ErrorType[]; primary: ErrorType }) {
  const known = (t: ErrorType) => t in ERROR_TYPE_LABELS;
  const ordered = [primary, ...types.filter((t) => t !== primary)].filter(known);
  if (ordered.length === 0) return <span className="text-muted-foreground">–</span>;
  return (
    <ul className="flex flex-wrap gap-1.5" aria-label="Error types">
      {ordered.map((t) => (
        <li key={t}>
          <span
            title={t === primary ? "Main error type" : undefined}
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ring-1 ring-inset",
              TYPE_STYLES[t],
            )}
          >
            {t === primary && <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />}
            {ERROR_TYPE_LABELS[t]}
            {t === primary && <span className="sr-only"> (main type)</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Long text, clamped with a Show more toggle so table rows stay scannable. */
export function ClampedText({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const long = text.length > 240 || text.split("\n").length > 4;
  return (
    <div>
      <p className={cn("whitespace-pre-line", long && !open && "line-clamp-5")}>{text}</p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="mt-1 rounded text-xs font-medium text-muted-foreground underline underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}

const NOTICE_STYLES = {
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-950 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-100",
  warning:
    "border-amber-200 bg-amber-50 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100",
  error:
    "border-red-200 bg-red-50 text-red-950 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-100",
  info: "border-border bg-muted/50 text-foreground",
} as const;

const NOTICE_ICONS = { success: CircleCheck, warning: Info, error: CircleAlert, info: Info } as const;

/** A tinted message box. Errors announce themselves; the rest are polite status text. */
export function Notice({
  tone,
  title,
  children,
  className,
}: {
  tone: keyof typeof NOTICE_STYLES;
  title?: string;
  children?: ReactNode;
  className?: string;
}) {
  const Icon = NOTICE_ICONS[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex gap-3 rounded-xl border p-4 text-sm", NOTICE_STYLES[tone], className)}
    >
      <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className="leading-relaxed">{children}</div>}
      </div>
    </div>
  );
}

/** A labelled block of text inside a card ("What went wrong", "Correct approach", ...). */
export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</h4>
      <div className="text-sm leading-relaxed">{children}</div>
    </div>
  );
}

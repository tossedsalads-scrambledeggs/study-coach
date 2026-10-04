"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { ThreadPrimitive, type ToolCallMessagePartStatus } from "@assistant-ui/react";
import { AlertCircleIcon, ArrowRightIcon, LoaderCircleIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Reading tool results without trusting their shape
// ---------------------------------------------------------------------------

export type Rec = Record<string, unknown>;

export const asRec = (v: unknown): Rec | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Rec) : null;

export const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

export const asNum = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export type ToolState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: Rec };

/** Collapse assistant-ui's status, result and isError into one of three states a card can render. */
export function resolveToolState(part: {
  result?: unknown;
  status?: ToolCallMessagePartStatus;
  isError?: boolean;
}): ToolState {
  const rec = asRec(part.result);
  const error = rec ? asStr(rec.error) : null;
  if (error) return { kind: "error", message: error };
  if (part.isError) return { kind: "error", message: "Something went wrong while running this step." };
  if (rec) return { kind: "ready", data: rec };
  const status = part.status;
  if (status?.type === "incomplete") {
    return {
      kind: "error",
      message: status.reason === "cancelled" ? "This was stopped before it finished." : "This step did not finish.",
    };
  }
  if (status?.type === "complete") return { kind: "error", message: "No result came back." };
  return { kind: "loading" };
}

/** "2026-10-06" -> "Oct 6". Parsed by hand so the day never shifts with the time zone. */
export function formatDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ---------------------------------------------------------------------------
// Card frame
// ---------------------------------------------------------------------------

export type Tone = "default" | "success" | "warning" | "danger";

const iconTone: Record<Tone, string> = {
  default: "bg-foreground/[0.07] text-foreground",
  success: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  warning: "bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  danger: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

const frameTone: Record<Tone, string> = {
  default: "",
  success: "border-emerald-200 dark:border-emerald-900",
  warning: "border-amber-200 dark:border-amber-900",
  danger: "border-rose-200 dark:border-rose-900",
};

export function ToolCard({
  icon,
  kicker,
  aside,
  tone = "default",
  label,
  className,
  children,
}: {
  icon: ReactNode;
  kicker: string;
  aside?: ReactNode;
  tone?: Tone;
  label?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-label={label ?? kicker}
      className={cn(
        "my-3 w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow-xs",
        frameTone[tone],
        className,
      )}
    >
      <header className="flex items-center gap-2.5 border-b bg-muted/40 px-4 py-2.5">
        <span aria-hidden className={cn("grid size-6 shrink-0 place-items-center rounded-md [&_svg]:size-3.5", iconTone[tone])}>
          {icon}
        </span>
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{kicker}</h3>
        {aside ? <div className="ml-auto flex flex-wrap items-center justify-end gap-2">{aside}</div> : null}
      </header>
      <div className="space-y-4 px-4 py-4 text-[0.95rem] leading-relaxed">{children}</div>
    </section>
  );
}

export function ToolCardLoading({ label, lines = 2 }: { label: string; lines?: number }) {
  return (
    <div role="status" aria-live="polite" className="space-y-3">
      <p className="text-muted-foreground flex items-center gap-2 text-sm">
        <LoaderCircleIcon aria-hidden className="size-4 animate-spin motion-reduce:animate-none" />
        <span className="shimmer motion-reduce:animate-none">{label}</span>
      </p>
      <div className="space-y-2" aria-hidden>
        {Array.from({ length: lines }, (_, i) => (
          <Skeleton key={i} className={cn("h-4 motion-reduce:animate-none", i === lines - 1 ? "w-3/5" : "w-full")} />
        ))}
      </div>
    </div>
  );
}

export function ToolCardError({
  kicker,
  title,
  message,
  hint = "Ask the coach to try again.",
  tone = "danger",
}: {
  kicker: string;
  title: string;
  message?: string;
  hint?: string;
  tone?: Tone;
}) {
  return (
    <ToolCard tone={tone} icon={<AlertCircleIcon />} kicker={kicker}>
      <div role="alert" className="space-y-1">
        <p className="font-medium text-balance">{title}</p>
        {message ? <p className="text-muted-foreground text-sm break-words">{message}</p> : null}
        <p className="text-muted-foreground text-sm">{hint}</p>
      </div>
    </ToolCard>
  );
}

export function ToolCardEmpty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <p className="font-medium text-balance">{title}</p>
      {children ? <div className="text-muted-foreground text-sm">{children}</div> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small pieces
// ---------------------------------------------------------------------------

export type ChipTone = "neutral" | "strong" | "success" | "warning" | "danger";

const chipTone: Record<ChipTone, string> = {
  neutral: "border-border bg-muted/50 text-foreground/80",
  strong: "border-transparent bg-foreground text-background",
  success: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-200",
  warning: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200",
  danger: "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-200",
};

export function Chip({
  tone = "neutral",
  className,
  children,
  ...rest
}: { tone?: ChipTone; className?: string; children: ReactNode } & Omit<React.ComponentProps<"span">, "className" | "children">) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap tabular-nums",
        chipTone[tone],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("space-y-1", className)}>
      <dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</dt>
      <dd className="text-pretty whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

export function CardLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-sm text-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-2"
    >
      {children}
      <ArrowRightIcon aria-hidden className="size-3.5" />
    </Link>
  );
}

/** Sends a chat message when pressed (and is disabled while the coach is still answering). */
export function ContinueButton({ prompt, children }: { prompt: string; children: ReactNode }) {
  return (
    <ThreadPrimitive.Suggestion prompt={prompt} send className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}>
      {children}
      <ArrowRightIcon aria-hidden className="size-3.5" />
    </ThreadPrimitive.Suggestion>
  );
}

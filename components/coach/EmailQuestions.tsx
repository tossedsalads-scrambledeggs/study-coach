"use client";

import { useState } from "react";
import { CircleCheckIcon, LoaderCircleIcon, MailIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type MailState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "sent"; count: number }
  | { kind: "nothing" }
  | { kind: "wait" }
  | { kind: "error"; message: string };

const EMAIL_ADDRESS = /[^\s@<>()"']+@[^\s@<>()"']+\.[^\s@<>()"']+/g;

export const WAIT_MESSAGE = "Please wait a minute before sending again.";
const FALLBACK_ERROR = "Couldn't send your questions. Please try again.";

/** Turn the answer from POST /api/mail/send into what the page shows. An email address never gets through. */
export function readSendResult(status: number, body: unknown): MailState {
  const rec = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;

  if (status === 429) return { kind: "wait" };

  if (status >= 200 && status < 300) {
    const sent = rec?.sent;
    if (typeof sent !== "number" || !Number.isFinite(sent) || sent < 0) return { kind: "error", message: FALLBACK_ERROR };
    return sent > 0 ? { kind: "sent", count: Math.floor(sent) } : { kind: "nothing" };
  }

  const fromServer = typeof rec?.error === "string" ? rec.error.trim() : "";
  const message = fromServer ? fromServer.replace(EMAIL_ADDRESS, "your inbox").slice(0, 160) : FALLBACK_ERROR;
  return { kind: "error", message };
}

/** The button, the one line that explains the loop, and the result. Pure: state in, callbacks out. */
export function EmailQuestionsView({ state, onSend }: { state: MailState; onSend: () => void }) {
  const sending = state.kind === "sending";

  return (
    <section aria-labelledby="mail-heading" className="space-y-3">
      <h2 id="mail-heading" className="text-lg font-semibold tracking-tight">
        Study from your inbox
      </h2>
      <div className="bg-card flex flex-col items-start gap-3 rounded-xl border p-5 shadow-xs sm:p-6">
        <Button size="lg" onClick={onSend} disabled={sending} aria-busy={sending}>
          {sending ? (
            <LoaderCircleIcon aria-hidden className="animate-spin motion-reduce:animate-none" />
          ) : (
            <MailIcon aria-hidden />
          )}
          {sending ? "Sending…" : "Email me my questions"}
        </Button>
        <p className="text-muted-foreground max-w-prose text-sm text-pretty">
          Reply to the email with your answer and the coach grades it in the same thread.
        </p>

        <div aria-live="polite" className="min-h-5 text-sm">
          {state.kind === "sending" ? <p className="text-muted-foreground">Sending your questions…</p> : null}
          {state.kind === "sent" ? (
            <p className="inline-flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300">
              <CircleCheckIcon aria-hidden className="size-4" />
              <span className="tabular-nums">{`Sent ${state.count} to your inbox.`}</span>
            </p>
          ) : null}
          {state.kind === "nothing" ? <p className="text-muted-foreground">Nothing due right now.</p> : null}
          {state.kind === "wait" ? (
            <p role="alert" className={cn("inline-flex items-center gap-1.5 text-amber-900 dark:text-amber-200")}>
              <TriangleAlertIcon aria-hidden className="size-4" />
              {WAIT_MESSAGE}
            </p>
          ) : null}
          {state.kind === "error" ? (
            <p role="alert" className="inline-flex items-center gap-1.5 text-rose-800 dark:text-rose-300">
              <TriangleAlertIcon aria-hidden className="size-4 shrink-0" />
              <span className="text-pretty">{state.message}</span>
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

export function EmailQuestions() {
  const [state, setState] = useState<MailState>({ kind: "idle" });

  async function send() {
    if (state.kind === "sending") return;
    setState({ kind: "sending" });
    try {
      const res = await fetch("/api/mail/send", { method: "POST" });
      const body: unknown = await res.json().catch(() => null);
      setState(readSendResult(res.status, body));
    } catch {
      setState({ kind: "error", message: "Couldn't reach the server. Check your connection and try again." });
    }
  }

  return <EmailQuestionsView state={state} onSend={send} />;
}

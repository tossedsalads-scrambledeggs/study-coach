import { agentMailClient, getCoachInbox } from "@/lib/agentmail";
import { STUDENT_ID, type Grade } from "@/lib/contracts";
import { query } from "@/lib/db";
import { answerRedrill, dueRedrills } from "@/lib/services/errors";
import { answerQuiz, nextQuizQuestion } from "@/lib/services/quiz";

/**
 * Mail coach: emails the student what is due (one question per thread), then grades the emailed reply and
 * answers in the same thread.
 *
 * Privacy: the student's address is read from STUDENT_EMAIL only. It is never logged, returned or stored in code.
 */

export type InboundResult = { ignored: true } | { graded: true; passed: boolean };

type MailKind = "redrill" | "quiz";

interface MailThreadRow {
  course_id: string;
  thread_id: string;
  kind: string;
  ref_id: string | null;
  question: string;
}

interface OutgoingQuestion {
  kind: MailKind;
  refId: string;
  courseId: string;
  subject: string;
  question: string;
  text: string;
}

type Json = Record<string, unknown>;

const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() !== "" ? value : undefined;

/** Webhook payloads are snake_case; accept the SDK's camelCase too. */
const field = (obj: Json, snake: string, camel: string): unknown => obj[snake] ?? obj[camel];

/** A subject must stay on one line. */
const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();

/** Run a best-effort step: its failure must not undo the work already done. */
async function attempt(step: () => unknown): Promise<void> {
  try {
    await step();
  } catch {
    // intentionally ignored
  }
}

function studentEmail(): string {
  const email = process.env.STUDENT_EMAIL?.trim();
  if (!email) throw new Error("STUDENT_EMAIL must be set");
  return email;
}

/** "Name <addr@host>" -> "addr@host", lower-cased. */
function bareAddress(value: string): string {
  const match = value.match(/<([^<>]+)>\s*$/);
  return (match ? match[1] : value).trim().toLowerCase();
}

/** Error text that is safe to log: no email addresses and no API key. */
function safeMessage(error: unknown): string {
  let text = error instanceof Error ? error.message : "unknown error";
  for (const secret of [process.env.AGENT_MAIL_KEY, process.env.STUDENT_EMAIL]) {
    if (secret) text = text.replace(new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), "[redacted]");
  }
  return text.replace(/[^\s<>"',;()]+@[^\s<>"',;()]+/g, "[email]").slice(0, 200);
}

async function currentCourseId(): Promise<string | undefined> {
  const rows = await query<{ id?: string; course_id?: string }>(
    "select id from courses where student_id = $1 order by created_at desc limit 1",
    [STUDENT_ID],
  );
  return rows?.[0]?.id ?? rows?.[0]?.course_id;
}

// ---------------------------------------------------------------------------
// Outbound: email what is due
// ---------------------------------------------------------------------------

/** The send route is public, so a send is held back this long after the last question went out. */
const THROTTLE_SECONDS = 60;
/** The most emails one sendDue() call sends; whatever else is due waits for the next call. */
const MAX_PER_SEND = 2;

/** What sendDue() rejects with while its send guard holds sends back; the route answers 429. */
export class SendThrottledError extends Error {
  readonly throttled = true;
  constructor() {
    super("Please wait a minute before sending again.");
    this.name = "SendThrottledError";
  }
}

async function sentRecently(): Promise<boolean> {
  const rows = await query(
    `select 1 from mail_threads where created_at > now() - interval '${THROTTLE_SECONDS} seconds' limit 1`,
  );
  return (rows?.length ?? 0) > 0;
}

/** A send in progress: concurrent calls would all pass the database check before the first row exists. */
let sending = false;

/**
 * Email the student the due re-drills (one thread each, at most 2 per call) or, when none are due, one
 * method-quiz question. Each question is recorded in mail_threads so the emailed reply can be matched and graded.
 * Returns how many emails were sent.
 *
 * Guard against spam on the public route: rejects with SendThrottledError (and sends nothing) when a question
 * was emailed in the last minute or another send is still running.
 */
export async function sendDue(): Promise<number> {
  if (sending) throw new SendThrottledError();
  sending = true;
  try {
    if (await sentRecently()) throw new SendThrottledError();
    return await sendQuestions();
  } finally {
    sending = false;
  }
}

async function sendQuestions(): Promise<number> {
  const due = (await dueRedrills()).slice(0, MAX_PER_SEND);
  const items: OutgoingQuestion[] = due.map((entry) => ({
    kind: "redrill",
    refId: entry.id,
    courseId: entry.courseId,
    subject: oneLine(`Re-drill: ${entry.problemLabel}`),
    question: entry.statement,
    text: `${entry.statement}\n\nReply to this email with your solution.`,
  }));

  if (items.length === 0) {
    const quiz = await nextQuizQuestion();
    const courseId = quiz ? await currentCourseId() : undefined;
    if (quiz && courseId) {
      items.push({
        kind: "quiz",
        refId: quiz.methodLineId,
        courseId,
        subject: `Method quiz: Unit ${quiz.unitNumber}`,
        question: quiz.question,
        text: `${quiz.question}\n\nReply with your first move.`,
      });
    }
  }
  if (items.length === 0) return 0;

  const to = studentEmail();
  const inbox = await getCoachInbox();
  const client = await agentMailClient();

  let sent = 0;
  let firstError: unknown;
  for (const item of items) {
    try {
      const response = await client.inboxes.messages.send(inbox.inboxId, {
        to,
        subject: item.subject,
        text: item.text,
      });
      const threadId = response.threadId ?? (response as unknown as { thread_id?: string }).thread_id;
      await query(
        `insert into mail_threads (course_id, thread_id, kind, ref_id, question)
         values ($1, $2, $3, $4, $5)
         on conflict (thread_id) do update
           set kind = excluded.kind, ref_id = excluded.ref_id, question = excluded.question`,
        [item.courseId, threadId, item.kind, item.refId, item.question],
      );
      sent += 1;
    } catch (error) {
      firstError ??= error;
      console.error(`mail: could not send a ${item.kind} question: ${safeMessage(error)}`);
    }
  }
  if (sent === 0 && firstError) throw firstError;
  return sent;
}

// ---------------------------------------------------------------------------
// Inbound: grade the emailed reply and answer in the same thread
// ---------------------------------------------------------------------------

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

interface ReplyBody {
  extractedText?: string;
  text?: string;
  extractedHtml?: string;
  html?: string;
}

/** The student's new text without quoted history: AgentMail's extracted text first, then the full body. */
function replyText(body: ReplyBody): string {
  return (
    nonEmpty(body.extractedText) ??
    nonEmpty(body.text) ??
    htmlToText(nonEmpty(body.extractedHtml) ?? nonEmpty(body.html) ?? "")
  ).trim();
}

/** Out-of-office and other automatic replies must never be graded (or answered: that could loop). */
function isAutomated(headers: unknown): boolean {
  if (!isRecord(headers)) return false;
  const h: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) h[name.toLowerCase()] = String(value).toLowerCase().trim();
  if (h["auto-submitted"] && h["auto-submitted"] !== "no") return true;
  if (h["x-autoreply"] !== undefined || h["x-autorespond"] !== undefined) return true;
  return ["bulk", "junk", "auto_reply", "list"].includes(h["precedence"] ?? "");
}

/** The sender must be STUDENT_EMAIL (compared as a bare, lower-cased address). */
function isFromStudent(message: Json): boolean {
  const from = message.from ?? message.from_;
  const senders = (Array.isArray(from) ? from : [from]).filter((s): s is string => typeof s === "string");
  const expected = bareAddress(studentEmail());
  return senders.length > 0 && senders.every((sender) => bareAddress(sender) === expected);
}

async function newRedrillDate(errorLogId: string): Promise<string | undefined> {
  try {
    const rows = await query<{ redrill_on?: string }>(
      "select redrill_on::text as redrill_on from error_log where id = $1",
      [errorLogId],
    );
    return nonEmpty(rows?.[0]?.redrill_on)?.slice(0, 10);
  } catch {
    return undefined;
  }
}

function verdictText(kind: MailKind, grade: Grade, redrillOn?: string): string {
  const lines = [grade.passed ? "Passed" : "Not yet", "", grade.feedback.trim(), ""];
  if (kind === "redrill") {
    lines.push(
      grade.passed
        ? "This problem is cleared. It moves to your shuffle pile and comes back later as a fresh variant."
        : `I set a new re-drill date${redrillOn ? ` (${redrillOn})` : ""}, so this problem will come back.`,
    );
  } else {
    lines.push(
      grade.passed
        ? "This method line is retired from your quiz."
        : "This method line stays in your quiz, so it will come up again.",
    );
  }
  return lines.join("\n");
}

/** Ignored mail is normal; the reason is logged (never an address) so a reply that goes nowhere can be traced. */
function ignore(reason: string): InboundResult {
  console.info(`mail: ignored (${reason})`);
  return { ignored: true };
}

/** Messages being handled right now: AgentMail redelivers a webhook that was slow to answer. */
const inFlight = new Set<string>();

/**
 * Handle an AgentMail `message.received` webhook payload.
 * Ignores anything that is not a reply from the student to a question this coach sent.
 */
export async function handleInbound(payload: unknown): Promise<InboundResult> {
  if (!isRecord(payload) || !isRecord(payload.message)) return ignore("no message in the payload");
  const eventType = nonEmpty(payload.event_type) ?? nonEmpty(payload.type);
  if (eventType !== "message.received") return ignore("not a message.received event");

  const message = payload.message;
  if (!isFromStudent(message)) return ignore("sender is not the student");
  if (isAutomated(message.headers)) return ignore("automatic reply");

  const thread = isRecord(payload.thread) ? payload.thread : {};
  const threadId =
    nonEmpty(field(message, "thread_id", "threadId")) ?? nonEmpty(field(thread, "thread_id", "threadId"));
  const messageId =
    nonEmpty(field(message, "message_id", "messageId")) ?? nonEmpty(field(thread, "last_message_id", "lastMessageId"));
  if (!threadId || !messageId) return ignore("no thread or message id");
  if (inFlight.has(messageId)) return ignore("already being handled");

  inFlight.add(messageId);
  try {
    const rows = await query<MailThreadRow>(
      "select course_id, thread_id, kind, ref_id, question from mail_threads where thread_id = $1",
      [threadId],
    );
    const mailThread = rows?.[0];
    if (!mailThread?.ref_id || (mailThread.kind !== "redrill" && mailThread.kind !== "quiz")) {
      return ignore("no open question in this thread");
    }
    const { kind, ref_id: refId, question } = mailThread;

    const inboxId = nonEmpty(field(message, "inbox_id", "inboxId")) ?? (await getCoachInbox()).inboxId;
    const client = await agentMailClient();
    const reply = (text: string) => client.inboxes.messages.reply(inboxId, messageId, { text });

    let answer = replyText({
      extractedText: nonEmpty(field(message, "extracted_text", "extractedText")),
      text: nonEmpty(message.text),
      extractedHtml: nonEmpty(field(message, "extracted_html", "extractedHtml")),
      html: nonEmpty(message.html),
    });
    const bodyOmitted = ["text", "html", "extracted_text", "extracted_html"].every((key) => message[key] === undefined);
    if (!answer && bodyOmitted) {
      // Large messages arrive without body fields: fetch the full message from AgentMail.
      try {
        answer = replyText(await client.inboxes.messages.get(inboxId, messageId));
      } catch (error) {
        console.error(`mail: could not fetch the full reply: ${safeMessage(error)}`);
      }
    }
    if (!answer) {
      await attempt(() =>
        reply("I could not find any text in your reply. Please type your answer in the body of the email."),
      );
      return ignore("empty reply");
    }

    // A failure here (model, database, AgentMail) is unexpected: let it reject so the webhook answers 500
    // and AgentMail redelivers the reply.
    const grade =
      kind === "redrill"
        ? await answerRedrill(refId, answer)
        : await answerQuiz({ methodLineId: refId, question, answer });

    const redrillOn = kind === "redrill" && !grade.passed ? await newRedrillDate(refId) : undefined;
    await reply(verdictText(kind, grade, redrillOn));

    if (grade.passed) {
      // One pass closes the question: later chatter on these threads is ignored, never graded again.
      await attempt(() => query("delete from mail_threads where kind = $1 and ref_id = $2", [kind, refId]));
    }
    console.info(`mail: graded a ${kind} reply (${grade.passed ? "passed" : "not yet"})`);
    return { graded: true, passed: grade.passed };
  } finally {
    inFlight.delete(messageId);
  }
}

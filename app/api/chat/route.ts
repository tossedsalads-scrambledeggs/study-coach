import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  tool,
  type ToolSet,
  type UIMessage,
} from "ai";
import { z } from "zod";

export const maxDuration = 60;

const MODES = ["quiz", "log", "shuffle"] as const;
type Mode = (typeof MODES)[number];

const RequestSchema = z.object({
  mode: z.enum(MODES),
  messages: z.array(z.unknown()),
});

// ---------------------------------------------------------------------------
// Calling the other features: REST routes only, server-side, on our own origin.
// ---------------------------------------------------------------------------

type ApiResult = Record<string, unknown>;

/**
 * Our own origin first (what the request came in on). Behind a proxy that origin can redirect or refuse a
 * server-side call, so the local port is the fallback; it is only tried on network errors and redirects.
 */
function originsFor(req: Request): string[] {
  const own = new URL(req.url).origin;
  const local = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;
  return own === local ? [own] : [own, local];
}

async function callApi(
  origins: string[],
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
  signal?: AbortSignal,
): Promise<ApiResult> {
  const hasBody = init.body !== undefined;
  let failure = "The request failed.";

  for (const origin of origins) {
    try {
      const res = await fetch(new URL(path, origin), {
        method: init.method ?? "GET",
        headers: hasBody ? { "Content-Type": "application/json" } : undefined,
        body: hasBody ? JSON.stringify(init.body) : undefined,
        cache: "no-store",
        redirect: "manual",
        signal,
      });
      if (res.status >= 300 && res.status < 400) {
        failure = `The request was redirected (${res.status}).`;
        continue;
      }
      const text = await res.text();
      let data: unknown = null;
      try {
        data = text ? JSON.parse(text) : null;
      } catch {
        data = null;
      }
      const record: ApiResult =
        data && typeof data === "object" && !Array.isArray(data)
          ? (data as ApiResult)
          : data === null
            ? {}
            : { data };
      if (!res.ok) {
        const message =
          typeof record.error === "string" && record.error
            ? record.error
            : `The request failed (${res.status}).`;
        return { error: message, status: res.status };
      }
      return record;
    } catch (err) {
      if (signal?.aborted) return { error: "The request was cancelled." };
      failure = err instanceof Error ? err.message : failure;
    }
  }
  return { error: failure };
}

const isFailure = (r: ApiResult): boolean => typeof r.error === "string";

/** Drop undefined and blank-string fields so optional inputs the model left empty are simply absent. */
function compact<T extends Record<string, unknown>>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && !(typeof v === "string" && v.trim() === "")),
  ) as Partial<T>;
}

/** Best-effort: the method line behind a quiz question, so the grade card can show its trap. */
async function lookupLine(origins: string[], id: string, signal?: AbortSignal) {
  const res = await callApi(origins, "/api/method-lines", {}, signal);
  if (isFailure(res) || !Array.isArray(res.lines)) return null;
  const line = (res.lines as Record<string, unknown>[]).find((l) => l?.id === id);
  if (!line) return null;
  return {
    unitNumber: line.unitNumber,
    lecture: line.lecture ?? null,
    trigger: line.trigger,
    move: line.move,
    trap: line.trap,
    source: line.source ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tools per mode
// ---------------------------------------------------------------------------

const problemFields = {
  label: z.string().min(1).describe('Short name for the problem, e.g. "PS3 Q2" or "Ex 4 - Sample space, part 1"'),
  statement: z.string().min(1).describe("The full problem statement, as the student gave it"),
  unitNumber: z.number().int().min(1).describe("The course unit the problem belongs to"),
  lecture: z.string().optional().describe('The lecture, e.g. "Lec 5". Omit when the student does not know it'),
};

function toolsFor(mode: Mode, origins: string[]): ToolSet {
  switch (mode) {
    case "quiz":
      return {
        next_quiz_question: tool({
          description:
            "Get the next method-quiz question: a fresh scenario for a random method line the student has not passed yet. " +
            "Returns { question: { methodLineId, unitNumber, question } }, or { done: true } when every line in reach is passed.",
          inputSchema: z.object({}),
          execute: async (_input, { abortSignal }) =>
            callApi(origins, "/api/quiz/next", { method: "POST" }, abortSignal),
        }),
        grade_quiz_answer: tool({
          description:
            "Grade the student's answer to the current quiz question. Pass the methodLineId and question exactly as next_quiz_question returned them, and the student's answer word for word. " +
            "Returns { passed, feedback }.",
          inputSchema: z.object({
            methodLineId: z.string().describe("methodLineId from the last next_quiz_question result"),
            question: z.string().describe("The question text from the last next_quiz_question result"),
            answer: z.string().min(1).describe("The student's answer, verbatim"),
          }),
          execute: async (input, { abortSignal }) => {
            const grade = await callApi(origins, "/api/quiz/answer", { method: "POST", body: input }, abortSignal);
            if (isFailure(grade)) return grade;
            const line = await lookupLine(origins, input.methodLineId, abortSignal);
            return line ? { ...grade, line } : grade;
          },
        }),
      };

    case "log":
      return {
        log_error: tool({
          description:
            "Log a problem the student got wrong and have it diagnosed. Call it once you know the problem, its unit and the student's approach. " +
            "Returns { entry, pendingLine }: the diagnosis, the re-drill date, and a proposed method line awaiting approval (or null).",
          inputSchema: z.object({
            ...problemFields,
            studentApproach: z.string().min(1).describe("What the student actually did, in their own words"),
          }),
          execute: async (input, { abortSignal }) =>
            callApi(origins, "/api/errors", { method: "POST", body: compact(input) }, abortSignal),
        }),
        approve_method_line: tool({
          description:
            "Approve a proposed method line so it joins the method sheet. Use only when the student says in chat that they approve it.",
          inputSchema: z.object({ lineId: z.string().describe("pendingLine.id from the log_error result") }),
          execute: async ({ lineId }, { abortSignal }) =>
            callApi(origins, `/api/method-lines/${encodeURIComponent(lineId)}/approve`, { method: "POST" }, abortSignal),
        }),
        reject_method_line: tool({
          description:
            "Reject a proposed method line. Use only when the student says in chat that they do not want it.",
          inputSchema: z.object({ lineId: z.string().describe("pendingLine.id from the log_error result") }),
          execute: async ({ lineId }, { abortSignal }) =>
            callApi(origins, `/api/method-lines/${encodeURIComponent(lineId)}/reject`, { method: "POST" }, abortSignal),
        }),
        log_correct_problem: tool({
          description:
            "Save a problem the student got RIGHT to the shuffle pile, so it comes back later as a fresh variant. Returns { problemId }.",
          inputSchema: z.object({
            ...problemFields,
            answer: z.string().optional().describe("The correct answer, if the student gave one"),
          }),
          execute: async (input, { abortSignal }) =>
            callApi(origins, "/api/problems/correct", { method: "POST", body: compact(input) }, abortSignal),
        }),
      };

    case "shuffle":
      return {
        next_shuffle_problem: tool({
          description:
            "Get the next problem from the shuffle pile: a new problem that uses the same method as one the student solved before, with a new surface. " +
            "Returns { itemId, problemId, statement }, or { done: true } when the pile is empty.",
          inputSchema: z.object({}),
          execute: async (_input, { abortSignal }) =>
            callApi(origins, "/api/shuffle/next", { method: "POST" }, abortSignal),
        }),
        grade_shuffle_answer: tool({
          description:
            "Grade the student's answer to the current shuffle problem. Pass itemId and problemId exactly as next_shuffle_problem returned them, and the student's answer word for word. " +
            "Returns { passed, feedback, errorLogId }; errorLogId is set when a miss was added to the error log.",
          inputSchema: z.object({
            itemId: z.string().describe("itemId from the last next_shuffle_problem result"),
            problemId: z.string().describe("problemId from the last next_shuffle_problem result"),
            answer: z.string().min(1).describe("The student's answer, verbatim"),
          }),
          execute: async (input, { abortSignal }) =>
            callApi(origins, "/api/shuffle/answer", { method: "POST", body: input }, abortSignal),
        }),
      };
  }
}

// ---------------------------------------------------------------------------
// System prompts
// ---------------------------------------------------------------------------

const VOICE = `You are Study Coach: a calm, encouraging coach for one student in one course.
Write plain words in short replies (one to three sentences). No headings, no bullet lists, no emoji.
Cards for each tool result are shown to the student automatically, so never repeat a card's contents in your message. Write dates in plain words, like Oct 6, never as 2026-10-06.
If a tool returns an error, say so in one plain sentence and offer to try again. Never invent tool results.
Act, don't announce: when a step needs a tool, call it in this same reply. Never write "I'll log it now" or "let me grade that" and then stop without calling the tool.`;

const PROMPTS: Record<Mode, string> = {
  quiz: `${VOICE}

You are running the Method Quiz. A method line is: a trigger inside a problem, the move to make, and the trap to avoid.
Run it one question at a time:
1. Call next_quiz_question to get a fresh scenario. Never write quiz questions yourself. After the card appears, say at most "Your move." and wait.
2. Do not hint at, name or lead toward the move or the trap before the student has answered and been graded. If they ask for the answer first, ask them to take a guess; a first instinct is fine.
3. When the student answers, call grade_quiz_answer with the methodLineId and question from the latest next_quiz_question result and their answer word for word.
4. After the grade card appears, reply in one short sentence that does not repeat or paraphrase the feedback, for example "Nice, that one is retired. Ready for another?" or "Not yet. Want to try another?" Only call next_quiz_question again when the student asks to continue (for example "yes", "next", "another").
If next_quiz_question returns { done: true }, congratulate them and suggest logging a mistake or trying the shuffle pile.`,

  log: `${VOICE}

You are logging a mistake. The student gives you a problem they got wrong and how they approached it.
You need: the problem statement, the unit number, and what the student did or answered. The label is yours to write (a few words). The lecture is optional: ask for it at most once, and never wait on it.
Be decisive. If the student has given the problem, a unit, and any description of what they did or answered, that is enough: call log_error right away, with no message before it. Never ask them to restate, rephrase, confirm or paste something they already told you. Only ask when something is truly absent, in one short message that names just the missing pieces. Never guess a unit number. If they have given you nothing yet, ask for it all in one friendly sentence, for example: "Paste the problem, tell me its unit (and the lecture if you know it), and what you tried." Do not diagnose the mistake yourself: the log_error tool does that.
The diagnosis card (what went wrong, the correct approach, the lesson, the re-drill date, and any proposed method line with Approve and Reject buttons) appears automatically.
After the card appears, say one or two sentences: when the re-drill is, and if a method line was proposed, invite them to approve or reject it with the buttons on the card. If they say so in chat instead, call approve_method_line or reject_method_line with pendingLine.id from the log_error result.
If the student got a problem RIGHT and wants it to come back later, collect the same details and call log_correct_problem; it goes to the shuffle pile.
Do not log the same problem twice.`,

  shuffle: `${VOICE}

You are running the Shuffle Pile: new problems that use the same method as ones the student has solved before, with new surface details.
Run it one problem at a time:
1. Call next_shuffle_problem. Never write problems yourself. After the card appears, say at most "Your move." and wait.
2. Never give hints, methods, steps or answers before the student has answered and been graded.
3. When the student answers, call grade_shuffle_answer with the itemId and problemId from the latest next_shuffle_problem result and their answer word for word.
4. After the grade card appears, reply in one short sentence that does not repeat the feedback, for example "Nice, that one is cleared. Ready for another?" If they missed it and the result has an errorLogId, say it went into their error log for a re-drill. Only call next_shuffle_problem again when the student asks to continue.
If next_shuffle_problem returns { done: true }, tell them the pile is empty for now and that cleared problems will show up here.`,
};

// ---------------------------------------------------------------------------
// Route
// ---------------------------------------------------------------------------

function jsonError(message: string, status: number) {
  return Response.json({ error: message }, { status });
}

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return jsonError("The request body must be JSON.", 400);
  }
  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return jsonError('Send { mode: "quiz" | "log" | "shuffle", messages: [...] }.', 400);
  }
  const { mode, messages } = parsed.data;

  const baseURL = process.env.NEON_AI_GATEWAY_BASE_URL;
  const apiKey = process.env.NEON_AI_GATEWAY_TOKEN;
  if (!baseURL || !apiKey) {
    return jsonError("The coach is not connected to the AI gateway yet (gateway settings are missing).", 500);
  }

  const gateway = createOpenAICompatible({
    name: "neon",
    baseURL: `${baseURL.replace(/\/+$/, "")}/v1`,
    apiKey,
  });

  const tools = toolsFor(mode, originsFor(req));

  try {
    const result = streamText({
      model: gateway("gpt-5-mini"),
      system: PROMPTS[mode],
      messages: await convertToModelMessages(messages as UIMessage[], {
        tools,
        ignoreIncompleteToolCalls: true,
      }),
      tools,
      stopWhen: stepCountIs(6),
      abortSignal: req.signal,
    });

    return result.toUIMessageStreamResponse({
      onError: (error) => {
        const text = error instanceof Error ? error.message : String(error);
        return text.split(apiKey).join("[hidden]").slice(0, 300);
      },
    });
  } catch (err) {
    const text = err instanceof Error ? err.message : "Something went wrong.";
    return jsonError(text.split(apiKey).join("[hidden]").slice(0, 300), 500);
  }
}

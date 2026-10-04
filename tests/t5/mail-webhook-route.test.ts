/**
 * T5 (issue #6) - POST /api/mail/webhook (AgentMail `message.received`), tested at the route level with
 * the mail coach agent mocked.
 *
 * Spec (docs/PLAN.md sections 3 and 6, issue #6):
 *   - The parsed JSON payload is handed to handleInbound(payload) untouched.
 *   - 200 { ok: true, ...result } for any valid JSON body, ignored messages included
 *     ({ ok: true, ignored: true } or { ok: true, graded: true, passed }), so AgentMail never retries them.
 *   - 400 { error } for a body that is not JSON; handleInbound is not called.
 *   - 500 { error } when handleInbound rejects (PLAN section 6 convention: "500 with { error } on failure").
 *   - The student's address comes only from process.env.STUDENT_EMAIL and must never appear in any API
 *     response (body or headers), whatever the payload contains.
 *
 * Who the sender is, thread matching, grading and the in-thread reply all happen inside handleInbound
 * and are out of scope here. Only example.com addresses are used.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STUDENT = "student@example.com";
const COACH = "coach@example.com";
const STRANGER = "stranger@example.com";

const mocks = vi.hoisted(() => {
  // Set before any module loads, in case the route or something it imports reads it at import time.
  process.env.STUDENT_EMAIL = "student@example.com";
  return { sendDue: vi.fn(), handleInbound: vi.fn() };
});

vi.mock("@/lib/agents/mailCoach", () => ({
  sendDue: mocks.sendDue,
  handleInbound: mocks.handleInbound,
}));

import * as webhookRoute from "@/app/api/mail/webhook/route";

// ---------------------------------------------------------------------------
// helpers and fixtures
// ---------------------------------------------------------------------------

type RouteHandler = (req: Request) => Response | Promise<Response>;

interface Reply {
  status: number;
  contentType: string;
  /** Raw response body. */
  text: string;
  /** Every response header, one "name: value" per line. */
  headers: string;
  json: Record<string, unknown>;
}

/** Call a route handler the way Next does, and read everything the client would see. */
async function call(handler: unknown, req: Request): Promise<Reply> {
  const res = await (handler as RouteHandler)(req);
  const text = await res.text();
  const lines: string[] = [];
  res.headers.forEach((value, name) => lines.push(`${name}: ${value}`));
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new Error(`Response body is not JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }
  return {
    status: res.status,
    contentType: res.headers.get("content-type") ?? "",
    text,
    headers: lines.join("\n"),
    json,
  };
}

function rawRequest(body: string): Request {
  return new Request("http://test/api/mail/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function jsonRequest(payload: unknown): Request {
  return rawRequest(JSON.stringify(payload));
}

/** The student's address must not be in the body or in any header, in any letter case. */
function expectNoStudentAddress(reply: Reply): void {
  expect(reply.text.toLowerCase()).not.toContain(STUDENT);
  expect(reply.headers.toLowerCase()).not.toContain(STUDENT);
}

/** Shaped like an AgentMail message.received event. The route must treat it as opaque JSON. */
function messageReceived(from: string | string[], text = "The answer is 42."): Record<string, unknown> {
  const senders = Array.isArray(from) ? from : [from];
  return {
    type: "event",
    event_type: "message.received",
    event_id: "evt_t5_001",
    message: {
      inbox_id: COACH,
      thread_id: "thd_t5_001",
      message_id: "msg_t5_001",
      labels: ["received"],
      timestamp: "2026-10-04T17:00:00.000Z",
      from,
      to: [COACH],
      subject: "Re: Study Coach: re-drill",
      text,
    },
    thread: { thread_id: "thd_t5_001", senders, recipients: [COACH], subject: "Re: Study Coach: re-drill" },
  };
}

/** A real reply carries the quoted question underneath. Trimming it is the agent's job, not the route's. */
const REPLY_WITH_QUOTED_HISTORY =
  "Check independence first, then the covariance term is zero.\n\n" +
  "On Sun, Oct 4, 2026 at 9:00 AM Study Coach <coach@example.com> wrote:\n" +
  "> Re-drill: find Var(X + Y) when X and Y are dependent.\n" +
  "> Reply with your solution.";

beforeEach(() => {
  vi.stubEnv("STUDENT_EMAIL", STUDENT);
  mocks.sendDue.mockReset();
  mocks.handleInbound.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// valid JSON bodies
// ---------------------------------------------------------------------------

describe("POST /api/mail/webhook with a JSON body", () => {
  it("passes the parsed payload to handleInbound, untouched", async () => {
    const payload = messageReceived(`Student <${STUDENT}>`, REPLY_WITH_QUOTED_HISTORY);
    mocks.handleInbound.mockResolvedValue({ ignored: true });

    await call(webhookRoute.POST, jsonRequest(payload));

    expect(mocks.handleInbound).toHaveBeenCalledTimes(1);
    expect(mocks.handleInbound).toHaveBeenCalledWith(payload);
  });

  it("returns 200 { ok: true, graded: true, passed: true } for a graded result", async () => {
    mocks.handleInbound.mockResolvedValue({ graded: true, passed: true });

    const reply = await call(webhookRoute.POST, jsonRequest(messageReceived(`Student <${STUDENT}>`)));

    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ ok: true, graded: true, passed: true });
  });

  it("returns 200 { ok: true, graded: true, passed: false } when the answer did not pass", async () => {
    mocks.handleInbound.mockResolvedValue({ graded: true, passed: false });

    const reply = await call(webhookRoute.POST, jsonRequest(messageReceived(`Student <${STUDENT}>`)));

    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ ok: true, graded: true, passed: false });
  });

  it("returns 200 { ok: true, ignored: true } for an ignored result", async () => {
    mocks.handleInbound.mockResolvedValue({ ignored: true });

    const reply = await call(webhookRoute.POST, jsonRequest(messageReceived(`Student <${STUDENT}>`)));

    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ ok: true, ignored: true });
  });

  it("acknowledges a message from another sender with 200 (ignored), so AgentMail does not retry it", async () => {
    mocks.handleInbound.mockResolvedValue({ ignored: true });

    const reply = await call(webhookRoute.POST, jsonRequest(messageReceived(`Someone <${STRANGER}>`)));

    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ ok: true, ignored: true });
  });

  it.each([
    ["an empty object", {}],
    [
      "an event that is not message.received",
      { type: "event", event_type: "message.sent", event_id: "evt_t5_002", message: { thread_id: "thd_t5_001" } },
    ],
  ] as const)("returns 200 for any valid JSON body: %s", async (_label, payload) => {
    mocks.handleInbound.mockResolvedValue({ ignored: true });

    const reply = await call(webhookRoute.POST, jsonRequest(payload));

    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ ok: true, ignored: true });
  });

  it("responds with a JSON content type", async () => {
    mocks.handleInbound.mockResolvedValue({ graded: true, passed: true });

    const reply = await call(webhookRoute.POST, jsonRequest(messageReceived(`Student <${STUDENT}>`)));

    expect(reply.contentType).toMatch(/application\/json/i);
  });
});

// ---------------------------------------------------------------------------
// bodies that are not JSON
// ---------------------------------------------------------------------------

describe("POST /api/mail/webhook with a body that is not JSON", () => {
  it.each([
    ["plain text", "not json"],
    ["an empty body", ""],
    ["truncated JSON", '{"event_type": "message.received", "message": {'],
  ] as const)("returns 400 { error } and never calls handleInbound (%s)", async (_label, body) => {
    const reply = await call(webhookRoute.POST, rawRequest(body));

    expect(reply.status).toBe(400);
    expect(reply.json).toMatchObject({ error: expect.any(String) });
    expect(reply.json.error).not.toBe("");
    expect(mocks.handleInbound).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// failures inside handleInbound
// ---------------------------------------------------------------------------

describe("POST /api/mail/webhook when handleInbound fails (PLAN section 6: 500 with { error } on failure)", () => {
  it("returns 500 { error } when handleInbound rejects", async () => {
    mocks.handleInbound.mockRejectedValue(new Error("database is unreachable"));

    const reply = await call(webhookRoute.POST, jsonRequest(messageReceived(`Student <${STUDENT}>`)));

    expect(reply.status).toBe(500);
    expect(reply.json).toMatchObject({ error: expect.any(String) });
    expect(reply.json.error).not.toBe("");
    expect(mocks.handleInbound).toHaveBeenCalledTimes(1);
  });

  it("still returns 500 { error } when handleInbound rejects with a plain string instead of an Error", async () => {
    mocks.handleInbound.mockRejectedValue("grader timed out");

    const reply = await call(webhookRoute.POST, jsonRequest(messageReceived(`Student <${STUDENT}>`)));

    expect(reply.status).toBe(500);
    expect(reply.json).toMatchObject({ error: expect.any(String) });
    expect(reply.json.error).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// privacy: the student's address never appears in an API response
// ---------------------------------------------------------------------------

describe("POST /api/mail/webhook privacy: STUDENT_EMAIL never appears in a response", () => {
  it("never contains the student's address in the response body, even when the payload's from field is that address", async () => {
    mocks.handleInbound.mockResolvedValue({ graded: true, passed: true });

    const reply = await call(webhookRoute.POST, jsonRequest(messageReceived(`Student <${STUDENT}>`)));

    expect(reply.status).toBe(200);
    expect(reply.text.toLowerCase()).not.toContain(STUDENT);
  });

  const FROM_VARIANTS: [string, string | string[]][] = [
    ["a bare address", STUDENT],
    ["a display-name address", `Student <${STUDENT}>`],
    ["a list of addresses", [`Student <${STUDENT}>`]],
  ];
  const RESULTS: [string, Record<string, unknown>][] = [
    ["a passed grade", { graded: true, passed: true }],
    ["a failed grade", { graded: true, passed: false }],
    ["an ignored message", { ignored: true }],
  ];

  describe.each(FROM_VARIANTS)("payload from is %s", (_fromLabel, from) => {
    it.each(RESULTS)("answers %s with exactly { ok: true, ...result } and no address", async (_resultLabel, result) => {
      mocks.handleInbound.mockResolvedValue(result);

      const reply = await call(webhookRoute.POST, jsonRequest(messageReceived(from)));

      expect(reply.status).toBe(200);
      expect(reply.json).toEqual({ ok: true, ...result });
      expectNoStudentAddress(reply);
    });
  });

  it("does not echo a body that is not JSON: the 400 reply stays free of the address (V8 parse errors quote short bodies verbatim)", async () => {
    // JSON.parse("student@example.com") throws: Unexpected token 's', "student@example.com" is not valid JSON
    const reply = await call(webhookRoute.POST, rawRequest(STUDENT));

    expect(reply.status).toBe(400);
    expect(reply.json).toMatchObject({ error: expect.any(String) });
    expect(reply.json.error).not.toBe("");
    expectNoStudentAddress(reply);
    expect(mocks.handleInbound).not.toHaveBeenCalled();
  });

  it("when handleInbound fails with an error message that names the student", async () => {
    mocks.handleInbound.mockRejectedValue(new Error(`AgentMail could not reply to ${STUDENT}: thread not found`));

    const reply = await call(webhookRoute.POST, jsonRequest(messageReceived(`Student <${STUDENT}>`)));

    expect(reply.status).toBe(500);
    expect(reply.json).toMatchObject({ error: expect.any(String) });
    expect(reply.json.error).not.toBe("");
    expectNoStudentAddress(reply);
  });

  it("when handleInbound rejects with a string that names the student", async () => {
    mocks.handleInbound.mockRejectedValue(`bounce from ${STUDENT}`);

    const reply = await call(webhookRoute.POST, jsonRequest(messageReceived(`Student <${STUDENT}>`)));

    expect(reply.status).toBe(500);
    expectNoStudentAddress(reply);
  });
});

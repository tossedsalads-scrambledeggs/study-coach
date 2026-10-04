/**
 * T5 (issue #6) - POST /api/mail/send, tested at the route level with the mail coach agent mocked.
 *
 * Spec (docs/PLAN.md sections 3 and 6, issue #6):
 *   - POST /api/mail/send answers 200 { sent: number }, the number being what sendDue() resolves.
 *   - 500 { error } when sendDue() rejects.
 *   - The student's address comes only from process.env.STUDENT_EMAIL and must never appear in any
 *     API response (body or headers), error responses included.
 *
 * The AgentMail SDK and the database are never touched: @/lib/agents/mailCoach is replaced wholesale.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STUDENT = "student@example.com";

const mocks = vi.hoisted(() => {
  // Set before any module loads, in case the route or something it imports reads it at import time.
  process.env.STUDENT_EMAIL = "student@example.com";
  return { sendDue: vi.fn(), handleInbound: vi.fn() };
});

vi.mock("@/lib/agents/mailCoach", () => ({
  sendDue: mocks.sendDue,
  handleInbound: mocks.handleInbound,
}));

import * as sendRoute from "@/app/api/mail/send/route";

// ---------------------------------------------------------------------------
// helpers
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

function sendRequest(body?: string): Request {
  return new Request("http://test/api/mail/send", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

/** The student's address must not be in the body or in any header, in any letter case. */
function expectNoStudentAddress(reply: Reply): void {
  expect(reply.text.toLowerCase()).not.toContain(STUDENT);
  expect(reply.headers.toLowerCase()).not.toContain(STUDENT);
}

beforeEach(() => {
  vi.stubEnv("STUDENT_EMAIL", STUDENT);
  mocks.sendDue.mockReset();
  mocks.handleInbound.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

// ---------------------------------------------------------------------------
// success
// ---------------------------------------------------------------------------

describe("POST /api/mail/send", () => {
  it("returns 200 { sent: 2 } when sendDue resolves 2", async () => {
    mocks.sendDue.mockResolvedValue(2);

    const reply = await call(sendRoute.POST, sendRequest("{}"));

    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ sent: 2 });
    expect(mocks.sendDue).toHaveBeenCalledTimes(1);
  });

  it("returns 200 { sent: 0 } when nothing is due (zero is a normal answer, not a failure)", async () => {
    mocks.sendDue.mockResolvedValue(0);

    const reply = await call(sendRoute.POST, sendRequest("{}"));

    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ sent: 0 });
  });

  it.each([1, 3, 12])("reports exactly what sendDue resolves (sent: %i)", async (count) => {
    mocks.sendDue.mockResolvedValue(count);

    const reply = await call(sendRoute.POST, sendRequest("{}"));

    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ sent: count });
  });

  it("responds with a JSON content type", async () => {
    mocks.sendDue.mockResolvedValue(1);

    const reply = await call(sendRoute.POST, sendRequest("{}"));

    expect(reply.contentType).toMatch(/application\/json/i);
  });

  it.each([
    ["no body at all", undefined],
    ["an empty JSON object", "{}"],
  ] as const)("needs no request input: works with %s", async (_label, body) => {
    mocks.sendDue.mockResolvedValue(1);

    const reply = await call(sendRoute.POST, sendRequest(body));

    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ sent: 1 });
    expect(mocks.sendDue).toHaveBeenCalledTimes(1);
  });

  it("calls sendDue with no arguments and ignores any recipient in the request (the address only comes from STUDENT_EMAIL)", async () => {
    mocks.sendDue.mockResolvedValue(1);
    const body = JSON.stringify({ to: "attacker@example.com", email: "attacker@example.com" });

    const reply = await call(sendRoute.POST, sendRequest(body));

    expect(reply.status).toBe(200);
    expect(reply.json).toEqual({ sent: 1 });
    expect(mocks.sendDue).toHaveBeenCalledWith();
    expect(reply.text.toLowerCase()).not.toContain("attacker@example.com");
  });
});

// ---------------------------------------------------------------------------
// failure
// ---------------------------------------------------------------------------

describe("POST /api/mail/send when sendDue fails", () => {
  it("returns 500 { error } when sendDue rejects", async () => {
    mocks.sendDue.mockRejectedValue(new Error("AgentMail is unavailable"));

    const reply = await call(sendRoute.POST, sendRequest("{}"));

    expect(reply.status).toBe(500);
    expect(reply.json).toMatchObject({ error: expect.any(String) });
    expect(reply.json.error).not.toBe("");
  });

  it("calls sendDue only once when it fails (a retry loop could email the student twice)", async () => {
    mocks.sendDue.mockRejectedValue(new Error("AgentMail is unavailable"));

    await call(sendRoute.POST, sendRequest("{}"));

    expect(mocks.sendDue).toHaveBeenCalledTimes(1);
  });

  it("still returns 500 { error } when sendDue rejects with a plain string instead of an Error", async () => {
    mocks.sendDue.mockRejectedValue("inbox quota exceeded");

    const reply = await call(sendRoute.POST, sendRequest("{}"));

    expect(reply.status).toBe(500);
    expect(reply.json).toMatchObject({ error: expect.any(String) });
    expect(reply.json.error).not.toBe("");
  });
});

// ---------------------------------------------------------------------------
// privacy: the student's address never appears in an API response
// ---------------------------------------------------------------------------

describe("POST /api/mail/send privacy: STUDENT_EMAIL never appears in a response", () => {
  it("when emails were sent", async () => {
    mocks.sendDue.mockResolvedValue(3);

    const reply = await call(sendRoute.POST, sendRequest("{}"));

    expect(reply.status).toBe(200);
    expectNoStudentAddress(reply);
  });

  it("when nothing was due", async () => {
    mocks.sendDue.mockResolvedValue(0);

    const reply = await call(sendRoute.POST, sendRequest("{}"));

    expect(reply.status).toBe(200);
    expectNoStudentAddress(reply);
  });

  it("when sendDue fails with an error message that names the recipient (SDK errors often do)", async () => {
    mocks.sendDue.mockRejectedValue(new Error(`AgentMail rejected the recipient ${STUDENT}: mailbox full`));

    const reply = await call(sendRoute.POST, sendRequest("{}"));

    expect(reply.status).toBe(500);
    expect(reply.json).toMatchObject({ error: expect.any(String) });
    expect(reply.json.error).not.toBe("");
    expectNoStudentAddress(reply);
  });

  it("when sendDue rejects with a string that names the recipient", async () => {
    mocks.sendDue.mockRejectedValue(`bounce from ${STUDENT}`);

    const reply = await call(sendRoute.POST, sendRequest("{}"));

    expect(reply.status).toBe(500);
    expectNoStudentAddress(reply);
  });
});

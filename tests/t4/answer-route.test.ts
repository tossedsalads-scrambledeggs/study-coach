import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ShuffleService } from "@/lib/contracts";
import { ERROR_LOG_ID, ITEM_ID, PROBLEM_ID, emptyPost, expectErrorResponse, jsonPost, parse, rawPost } from "./helpers";
import type { RouteHandler } from "./helpers";

// The route is a thin wrapper over the service, so the service is mocked: no database, no model.
vi.mock("@/lib/services/shuffle", () => ({
  nextShuffleProblem: vi.fn(),
  answerShuffle: vi.fn(),
}));

import { answerShuffle, nextShuffleProblem } from "@/lib/services/shuffle";
import { POST } from "@/app/api/shuffle/answer/route";

// Compile-time only: the service module must satisfy the ShuffleService contract. Nothing here runs a service.
const _contract: ShuffleService = { nextShuffleProblem, answerShuffle };
void _contract;

const PATH = "/api/shuffle/answer";
const post = POST as unknown as RouteHandler;
const service = vi.mocked(answerShuffle);

const VALID = { itemId: ITEM_ID, problemId: PROBLEM_ID, answer: "1/13" };
const FIELDS = ["itemId", "problemId", "answer"] as const;

beforeEach(() => {
  service.mockReset();
});

describe("POST /api/shuffle/answer: success", () => {
  it("hands {itemId, problemId, answer} to answerShuffle and returns {passed, feedback, errorLogId: null} on a pass", async () => {
    service.mockResolvedValue({ passed: true, feedback: "Correct: 4/13 times 3/12 is 1/13.", errorLogId: null });

    const r = await parse(await post(jsonPost(PATH, VALID)));

    expect(r.status, `body: ${r.text}`).toBe(200);
    expect(r.body).toEqual({ passed: true, feedback: "Correct: 4/13 times 3/12 is 1/13.", errorLogId: null });
    expect(service).toHaveBeenCalledTimes(1);
    expect(service).toHaveBeenCalledWith(VALID);
  });

  it("returns the errorLogId from the service on a fail", async () => {
    service.mockResolvedValue({
      passed: false,
      feedback: "Not quite: after the first bead only 12 remain.",
      errorLogId: ERROR_LOG_ID,
    });

    const r = await parse(await post(jsonPost(PATH, { ...VALID, answer: "4/13 times 4/13" })));

    expect(r.status, `body: ${r.text}`).toBe(200);
    expect(r.body).toEqual({
      passed: false,
      feedback: "Not quite: after the first bead only 12 remain.",
      errorLogId: ERROR_LOG_ID,
    });
    expect(service).toHaveBeenCalledWith({ ...VALID, answer: "4/13 times 4/13" });
  });

  it("passes the answer to the service unchanged, including symbols and inner whitespace", async () => {
    const answer = "P = 4/13 × 3/12 ≈ 0.0769\n(no replacement)";
    service.mockResolvedValue({ passed: true, feedback: "Right.", errorLogId: null });

    await post(jsonPost(PATH, { ...VALID, answer }));

    expect(service).toHaveBeenCalledTimes(1);
    expect(service).toHaveBeenCalledWith({ itemId: ITEM_ID, problemId: PROBLEM_ID, answer });
  });
});

describe("POST /api/shuffle/answer: bad input returns 400 {error} and never reaches the service", () => {
  it.each(FIELDS)("when %s is missing", async (field) => {
    const body: Record<string, unknown> = { ...VALID };
    delete body[field];

    const r = await parse(await post(jsonPost(PATH, body)));

    expectErrorResponse(r, 400);
    expect(service).not.toHaveBeenCalled();
  });

  it.each(FIELDS)("when %s is an empty string", async (field) => {
    const r = await parse(await post(jsonPost(PATH, { ...VALID, [field]: "" })));

    expectErrorResponse(r, 400);
    expect(service).not.toHaveBeenCalled();
  });

  it.each([
    { field: "itemId", value: 123 },
    { field: "problemId", value: 123 },
    { field: "answer", value: 123 },
    { field: "answer", value: null },
    { field: "answer", value: ["1/13"] },
  ])("when $field is not a string ($value)", async ({ field, value }) => {
    const r = await parse(await post(jsonPost(PATH, { ...VALID, [field]: value })));

    expectErrorResponse(r, 400);
    expect(service).not.toHaveBeenCalled();
  });

  it("when the body is not valid JSON", async () => {
    const r = await parse(await post(rawPost(PATH, "{itemId: nope")));

    expectErrorResponse(r, 400);
    expect(service).not.toHaveBeenCalled();
  });

  it("when there is no body at all", async () => {
    const r = await parse(await post(emptyPost(PATH)));

    expectErrorResponse(r, 400);
    expect(service).not.toHaveBeenCalled();
  });
});

describe("POST /api/shuffle/answer: failures", () => {
  it("returns 500 with {error} when answerShuffle rejects", async () => {
    service.mockRejectedValue(new Error("database unavailable"));

    const r = await parse(await post(jsonPost(PATH, VALID)));

    expectErrorResponse(r, 500);
    expect(service).toHaveBeenCalledTimes(1);
  });
});

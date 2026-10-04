import { beforeEach, describe, expect, it, vi } from "vitest";
import { ITEM_ID, PROBLEM_ID, emptyPost, expectErrorResponse, jsonPost, parse } from "./helpers";
import type { RouteHandler } from "./helpers";

// The route is a thin wrapper over the service, so the service is mocked: no database, no model.
vi.mock("@/lib/services/shuffle", () => ({
  nextShuffleProblem: vi.fn(),
  answerShuffle: vi.fn(),
}));

import { nextShuffleProblem } from "@/lib/services/shuffle";
import { POST } from "@/app/api/shuffle/next/route";

const PATH = "/api/shuffle/next";
const post = POST as unknown as RouteHandler;
const service = vi.mocked(nextShuffleProblem);

const ITEM = {
  itemId: ITEM_ID,
  problemId: PROBLEM_ID,
  statement:
    "A jar contains 4 green and 9 yellow beads. Two beads are taken one at a time without replacement. What is the probability that both are green?",
};

// Markers that must never reach the student.
const SECRET_ANSWER = "SECRET-ANSWER-1/13";
const SECRET_SOLUTION = "SECRET-SOLUTION-4/13-times-3/12";

const REQUESTS: { name: string; make: () => Request }[] = [
  { name: "no body", make: () => emptyPost(PATH) },
  { name: "an empty JSON object body", make: () => jsonPost(PATH, {}) },
];

beforeEach(() => {
  service.mockReset();
});

describe("POST /api/shuffle/next", () => {
  it("returns 200 with {itemId, problemId, statement} from nextShuffleProblem", async () => {
    service.mockResolvedValue(ITEM);

    const r = await parse(await post(emptyPost(PATH)));

    expect(r.status, `body: ${r.text}`).toBe(200);
    expect(r.body).toEqual(ITEM);
    expect(service).toHaveBeenCalledTimes(1);
  });

  it.each(REQUESTS)("serves the next problem when the request has $name", async ({ make }) => {
    service.mockResolvedValue(ITEM);

    const r = await parse(await post(make()));

    expect(r.status, `body: ${r.text}`).toBe(200);
    expect(r.body).toEqual(ITEM);
  });

  it("returns exactly {done: true} with 200 when nextShuffleProblem resolves null", async () => {
    service.mockResolvedValue(null);

    const r = await parse(await post(emptyPost(PATH)));

    expect(r.status, `body: ${r.text}`).toBe(200);
    expect(r.body).toEqual({ done: true });
    expect(service).toHaveBeenCalledTimes(1);
  });

  it("never contains an answer field", async () => {
    service.mockResolvedValue(ITEM);

    const r = await parse(await post(emptyPost(PATH)));

    expect(r.body).not.toHaveProperty("answer");
    expect(Object.keys(r.body).sort()).toEqual(["itemId", "problemId", "statement"]);
  });

  it("exposes only itemId, problemId and statement even if the service result also carries the answer and solution", async () => {
    // Defensive check: the route must pick its fields, so a service that returns the whole problem row cannot leak the answer.
    const leaky = { ...ITEM, answer: SECRET_ANSWER, solution: SECRET_SOLUTION };
    service.mockResolvedValue(leaky as unknown as Awaited<ReturnType<typeof nextShuffleProblem>>);

    const r = await parse(await post(emptyPost(PATH)));

    expect(r.status, `body: ${r.text}`).toBe(200);
    expect(r.body).not.toHaveProperty("answer");
    expect(r.text).not.toContain(SECRET_ANSWER);
    expect(r.text).not.toContain(SECRET_SOLUTION);
    expect(r.body).toEqual(ITEM);
  });

  it("returns 500 with {error} when nextShuffleProblem rejects", async () => {
    service.mockRejectedValue(new Error("database unavailable"));

    const r = await parse(await post(emptyPost(PATH)));

    expectErrorResponse(r, 500);
  });
});

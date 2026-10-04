import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/quiz", () => ({
  nextQuizQuestion: vi.fn(),
  answerQuiz: vi.fn(),
  quizTracker: vi.fn(),
}));
vi.mock("@/lib/services/methodLines", () => ({
  listMethodLines: vi.fn(),
  approveLine: vi.fn(),
  rejectLine: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: vi.fn(), db: vi.fn() }));

import { POST as answerPOST } from "@/app/api/quiz/answer/route";
import { POST as nextPOST } from "@/app/api/quiz/next/route";
import { GET as trackerGET } from "@/app/api/quiz/tracker/route";
import type { QuizQuestion } from "@/lib/contracts";
import { query } from "@/lib/db";
import { answerQuiz, nextQuizQuestion, quizTracker } from "@/lib/services/quiz";
import {
  LINE_ID,
  OTHER_LINE_ID,
  asHandler,
  bareRequest,
  jsonRequest,
  malformedRequest,
  readJson,
} from "./helpers";

const next = asHandler(nextPOST);
const answer = asHandler(answerPOST);
const tracker = asHandler(trackerGET);

const NEXT_URL = "http://test/api/quiz/next";
const ANSWER_URL = "http://test/api/quiz/answer";
const TRACKER_URL = "http://test/api/quiz/tracker";

const nextMock = vi.mocked(nextQuizQuestion);
const answerMock = vi.mocked(answerQuiz);
const trackerMock = vi.mocked(quizTracker);

/** Routes may log a failure; keep the expected-500 tests quiet. */
function silenceConsoleError() {
  vi.spyOn(console, "error").mockImplementation(() => {});
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("quiz routes: exports", () => {
  it("export the HTTP handlers named in the REST table", () => {
    expect(typeof nextPOST).toBe("function");
    expect(typeof answerPOST).toBe("function");
    expect(typeof trackerGET).toBe("function");
  });
});

describe("POST /api/quiz/next", () => {
  const question: QuizQuestion = {
    methodLineId: LINE_ID,
    unitNumber: 2,
    question:
      "A courier logs two delivery times that may move together. What is the variance of their total? What is your first move?",
  };

  it("returns { question } with the QuizQuestion the service picked", async () => {
    nextMock.mockResolvedValue(question);
    const res = await next(bareRequest(NEXT_URL));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ question });
    expect(nextMock).toHaveBeenCalledTimes(1);
  });

  it("returns { done: true } when there is nothing left to ask", async () => {
    nextMock.mockResolvedValue(null);
    const res = await next(bareRequest(NEXT_URL));
    expect(res.status).toBe(200);
    const body = await readJson(res);
    expect(body).toEqual({ done: true });
    expect(body.question).toBeUndefined();
  });

  it("also works when the client sends an empty JSON body", async () => {
    nextMock.mockResolvedValue(question);
    const res = await next(jsonRequest(NEXT_URL, {}));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ question });
  });

  it("returns 500 with { error } when the service rejects", async () => {
    silenceConsoleError();
    nextMock.mockRejectedValue(new Error("connection refused"));
    const res = await next(bareRequest(NEXT_URL));
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("never queries the database itself", async () => {
    nextMock.mockResolvedValue(question);
    await next(bareRequest(NEXT_URL));
    expect(query).not.toHaveBeenCalled();
  });
});

describe("POST /api/quiz/answer", () => {
  const valid = {
    methodLineId: LINE_ID,
    question: "A courier logs two delivery times that may move together. What is your first move?",
    answer: "Check whether the two times are independent before adding variances.",
  };

  it("passes { methodLineId, question, answer } to answerQuiz and returns its Grade", async () => {
    const grade = { passed: true, feedback: "Right: check independence first." };
    answerMock.mockResolvedValue(grade);
    const res = await answer(jsonRequest(ANSWER_URL, valid));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual(grade);
    expect(answerMock).toHaveBeenCalledTimes(1);
    expect(answerMock).toHaveBeenCalledWith({
      methodLineId: valid.methodLineId,
      question: valid.question,
      answer: valid.answer,
    });
  });

  it("returns a failing Grade as a normal 200 response", async () => {
    const grade = {
      passed: false,
      feedback: "The move is to check independence first. You fell into the trap.",
    };
    answerMock.mockResolvedValue(grade);
    const res = await answer(
      jsonRequest(ANSWER_URL, { ...valid, answer: "Add Var(X) and Var(Y)." }),
    );
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual(grade);
  });

  it("forwards the id it was given, not a fixed one", async () => {
    answerMock.mockResolvedValue({ passed: true, feedback: "ok" });
    await answer(jsonRequest(ANSWER_URL, { ...valid, methodLineId: OTHER_LINE_ID }));
    expect(answerMock).toHaveBeenCalledWith(
      expect.objectContaining({ methodLineId: OTHER_LINE_ID }),
    );
  });

  describe("returns 400 with { error } and does not call the service", () => {
    const fields = ["methodLineId", "question", "answer"] as const;

    async function expectBadRequest(res: Response) {
      expect(res.status).toBe(400);
      const body = await readJson(res);
      expect(body.error).toBeTruthy();
      expect(answerMock).not.toHaveBeenCalled();
    }

    it.each(fields)("when %s is missing", async (field) => {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];
      await expectBadRequest(await answer(jsonRequest(ANSWER_URL, body)));
    });

    it.each(fields)("when %s is an empty string", async (field) => {
      await expectBadRequest(await answer(jsonRequest(ANSWER_URL, { ...valid, [field]: "" })));
    });

    it.each(fields)("when %s is not a string", async (field) => {
      await expectBadRequest(await answer(jsonRequest(ANSWER_URL, { ...valid, [field]: 42 })));
      answerMock.mockClear();
      await expectBadRequest(await answer(jsonRequest(ANSWER_URL, { ...valid, [field]: null })));
    });

    it("when the body is an empty object", async () => {
      await expectBadRequest(await answer(jsonRequest(ANSWER_URL, {})));
    });

    it("when there is no body", async () => {
      await expectBadRequest(await answer(bareRequest(ANSWER_URL)));
    });

    it("when the body is not valid JSON", async () => {
      await expectBadRequest(await answer(malformedRequest(ANSWER_URL)));
    });
  });

  it("returns 500 with { error } when the service rejects", async () => {
    silenceConsoleError();
    answerMock.mockRejectedValue(new Error("connection refused"));
    const res = await answer(jsonRequest(ANSWER_URL, valid));
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("never queries the database itself", async () => {
    answerMock.mockResolvedValue({ passed: true, feedback: "ok" });
    await answer(jsonRequest(ANSWER_URL, valid));
    expect(query).not.toHaveBeenCalled();
  });
});

describe("GET /api/quiz/tracker", () => {
  const result = {
    byUnit: [
      { unitNumber: 1, total: 4, passed: 3 },
      { unitNumber: 2, total: 5, passed: 0 },
      { unitNumber: 3, total: 2, passed: 2 },
    ],
  };

  it("returns { byUnit } with passed and total per unit", async () => {
    trackerMock.mockResolvedValue(result);
    const res = await tracker(new Request(TRACKER_URL));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ byUnit: result.byUnit });
    expect(trackerMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty byUnit list when there are no lines yet", async () => {
    trackerMock.mockResolvedValue({ byUnit: [] });
    const res = await tracker(new Request(TRACKER_URL));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ byUnit: [] });
  });

  it("returns 500 with { error } when the service rejects", async () => {
    silenceConsoleError();
    trackerMock.mockRejectedValue(new Error("connection refused"));
    const res = await tracker(new Request(TRACKER_URL));
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("never queries the database itself", async () => {
    trackerMock.mockResolvedValue(result);
    await tracker(new Request(TRACKER_URL));
    expect(query).not.toHaveBeenCalled();
  });
});

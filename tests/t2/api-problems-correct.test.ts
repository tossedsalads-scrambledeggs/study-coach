import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as errorsService from "@/lib/services/errors";
import { POST } from "@/app/api/problems/correct/route";
import { asHandler, correctProblemBody, expectErrorResponse, jsonRequest, rawRequest, without } from "./helpers";

vi.mock("@/lib/services/errors", () => ({
  logError: vi.fn(),
  listErrors: vi.fn(),
  dueRedrills: vi.fn(),
  answerRedrill: vi.fn(),
  logCorrectProblem: vi.fn(),
}));

const logCorrectProblem = vi.mocked(errorsService.logCorrectProblem);
const logError = vi.mocked(errorsService.logError);
const post = asHandler(POST);

const URL = "http://test/api/problems/correct";
const PROBLEM_ID = "00000000-0000-0000-0000-0000000000a1";

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/problems/correct (\"I got this right\")", () => {
  it("returns {problemId} from logCorrectProblem and hands it the parsed input", async () => {
    logCorrectProblem.mockResolvedValue({ problemId: PROBLEM_ID });
    const body = correctProblemBody({ lecture: "Lec 7", answer: "Var(X + Y) = 17" });

    const res = await post(jsonRequest(URL, body));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    expect(await res.json()).toEqual({ problemId: PROBLEM_ID });
    expect(logCorrectProblem).toHaveBeenCalledTimes(1);
    expect(logCorrectProblem).toHaveBeenCalledWith(
      expect.objectContaining({
        label: body.label,
        statement: body.statement,
        unitNumber: 3,
        lecture: "Lec 7",
        answer: "Var(X + Y) = 17",
      }),
    );
  });

  it("needs no student approach, and does not log an error", async () => {
    logCorrectProblem.mockResolvedValue({ problemId: PROBLEM_ID });

    const res = await post(jsonRequest(URL, correctProblemBody()));

    expect(res.status).toBe(200);
    expect(logError).not.toHaveBeenCalled();
  });

  it("passes the unit to the service as a number; lecture and answer are optional", async () => {
    logCorrectProblem.mockResolvedValue({ problemId: PROBLEM_ID });

    const res = await post(jsonRequest(URL, correctProblemBody({ unitNumber: 4 })));

    expect(res.status).toBe(200);
    expect(logCorrectProblem).toHaveBeenCalledTimes(1);
    const input = logCorrectProblem.mock.calls[0][0];
    expect(input.unitNumber).toBe(4);
    expect(typeof input.unitNumber).toBe("number");
    expect(input.lecture ?? null).toBeNull();
    expect(input.answer ?? null).toBeNull();
  });

  it("accepts null for lecture and answer (NewProblemInput allows null)", async () => {
    logCorrectProblem.mockResolvedValue({ problemId: PROBLEM_ID });

    const res = await post(jsonRequest(URL, correctProblemBody({ lecture: null, answer: null })));

    expect(res.status).toBe(200);
    expect(logCorrectProblem).toHaveBeenCalledTimes(1);
  });

  describe("400 on bad input, and the service is never called", () => {
    it.each(["label", "statement", "unitNumber"])("missing %s", async (field) => {
      const res = await post(jsonRequest(URL, without(correctProblemBody(), field)));

      await expectErrorResponse(res, 400);
      expect(logCorrectProblem).not.toHaveBeenCalled();
    });

    it.each(["label", "statement"])("empty %s", async (field) => {
      const res = await post(jsonRequest(URL, correctProblemBody({ [field]: "" })));

      await expectErrorResponse(res, 400);
      expect(logCorrectProblem).not.toHaveBeenCalled();
    });

    it("non-numeric unit", async () => {
      const res = await post(jsonRequest(URL, correctProblemBody({ unitNumber: "abc" })));

      await expectErrorResponse(res, 400);
      expect(logCorrectProblem).not.toHaveBeenCalled();
    });

    it("an empty object", async () => {
      const res = await post(jsonRequest(URL, {}));

      await expectErrorResponse(res, 400);
      expect(logCorrectProblem).not.toHaveBeenCalled();
    });

    it.each([
      ["malformed JSON", "{not json"],
      ["an empty body", undefined],
    ])("%s", async (_name, raw) => {
      const res = await post(rawRequest(URL, raw));

      await expectErrorResponse(res, 400);
      expect(logCorrectProblem).not.toHaveBeenCalled();
    });
  });

  it("500 with {error} when the service rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logCorrectProblem.mockRejectedValue(new Error("db down"));

    const res = await post(jsonRequest(URL, correctProblemBody()));

    await expectErrorResponse(res, 500);
  });
});

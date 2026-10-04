import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as errorsService from "@/lib/services/errors";
import { POST } from "@/app/api/errors/[id]/redrill/route";
import { asHandler, ENTRY_ID, expectErrorResponse, jsonRequest, rawRequest } from "./helpers";

vi.mock("@/lib/services/errors", () => ({
  logError: vi.fn(),
  listErrors: vi.fn(),
  dueRedrills: vi.fn(),
  answerRedrill: vi.fn(),
  logCorrectProblem: vi.fn(),
}));

const answerRedrill = vi.mocked(errorsService.answerRedrill);
const post = asHandler(POST);

const URL = `http://test/api/errors/${ENTRY_ID}/redrill`;
const ctx = (id: string = ENTRY_ID) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/errors/[id]/redrill", () => {
  it("grades a passing answer: returns the Grade and calls answerRedrill(id, answer)", async () => {
    answerRedrill.mockResolvedValue({ passed: true, feedback: "Right method and the right result." });

    const res = await post(jsonRequest(URL, { answer: "4 + 9 + 2(2) = 17" }), ctx());

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    expect(await res.json()).toEqual({ passed: true, feedback: "Right method and the right result." });
    expect(answerRedrill).toHaveBeenCalledTimes(1);
    expect(answerRedrill).toHaveBeenCalledWith(ENTRY_ID, "4 + 9 + 2(2) = 17");
  });

  it("returns a failing Grade unchanged", async () => {
    answerRedrill.mockResolvedValue({ passed: false, feedback: "You still left out the covariance term." });

    const res = await post(jsonRequest(URL, { answer: "13" }), ctx());

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ passed: false, feedback: "You still left out the covariance term." });
  });

  it("takes the error-log id from the route params", async () => {
    const otherId = "00000000-0000-0000-0000-0000000000e2";
    answerRedrill.mockResolvedValue({ passed: true, feedback: "ok" });

    await post(jsonRequest(`http://test/api/errors/${otherId}/redrill`, { answer: "17" }), ctx(otherId));

    expect(answerRedrill).toHaveBeenCalledWith(otherId, "17");
  });

  describe("400 on bad input, and the service is never called", () => {
    it("empty answer", async () => {
      const res = await post(jsonRequest(URL, { answer: "" }), ctx());

      await expectErrorResponse(res, 400);
      expect(answerRedrill).not.toHaveBeenCalled();
    });

    it("missing answer", async () => {
      const res = await post(jsonRequest(URL, {}), ctx());

      await expectErrorResponse(res, 400);
      expect(answerRedrill).not.toHaveBeenCalled();
    });

    it.each([
      ["malformed JSON", "{not json"],
      ["an empty body", undefined],
    ])("%s", async (_name, raw) => {
      const res = await post(rawRequest(URL, raw), ctx());

      await expectErrorResponse(res, 400);
      expect(answerRedrill).not.toHaveBeenCalled();
    });
  });

  it("500 with {error} when the service rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    answerRedrill.mockRejectedValue(new Error("db down"));

    const res = await post(jsonRequest(URL, { answer: "17" }), ctx());

    await expectErrorResponse(res, 500);
  });
});

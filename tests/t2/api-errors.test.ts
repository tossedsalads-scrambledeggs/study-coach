import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ErrorsService } from "@/lib/contracts";
import * as errorsService from "@/lib/services/errors";
import { GET, POST } from "@/app/api/errors/route";
import {
  asHandler,
  expectErrorResponse,
  jsonRequest,
  makeEntry,
  makePendingLine,
  newErrorBody,
  rawRequest,
  without,
} from "./helpers";

vi.mock("@/lib/services/errors", () => ({
  logError: vi.fn(),
  listErrors: vi.fn(),
  dueRedrills: vi.fn(),
  answerRedrill: vi.fn(),
  logCorrectProblem: vi.fn(),
}));

const logError = vi.mocked(errorsService.logError);
const listErrors = vi.mocked(errorsService.listErrors);
const post = asHandler(POST);
const get = asHandler(GET);

const URL = "http://test/api/errors";

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("services/errors matches the ErrorsService contract (type-level)", () => {
  it("exports every ErrorsService method", () => {
    const conforms: ErrorsService = errorsService;
    expect(conforms).toBeDefined();
  });
});

describe("POST /api/errors", () => {
  it("returns {entry, pendingLine} from logError and hands it the parsed input", async () => {
    const entry = makeEntry();
    const pendingLine = makePendingLine();
    logError.mockResolvedValue({ entry, pendingLine });
    const body = newErrorBody({ lecture: "Lec 7", answer: "Var(X + Y) = 17" });

    const res = await post(jsonRequest(URL, body));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    expect(await res.json()).toEqual({ entry, pendingLine });
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        label: body.label,
        statement: body.statement,
        unitNumber: 3,
        lecture: "Lec 7",
        answer: "Var(X + Y) = 17",
        studentApproach: body.studentApproach,
      }),
    );
  });

  it("returns pendingLine: null when no method line was drafted (pure computational slip)", async () => {
    const entry = makeEntry({ errorTypes: ["computational_slip"], primaryErrorType: "computational_slip", methodLineId: null });
    logError.mockResolvedValue({ entry, pendingLine: null });

    const res = await post(jsonRequest(URL, newErrorBody()));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.entry).toEqual(entry);
    expect(json).toHaveProperty("pendingLine", null);
  });

  it("passes the unit to the service as a number", async () => {
    logError.mockResolvedValue({ entry: makeEntry(), pendingLine: null });

    await post(jsonRequest(URL, newErrorBody({ unitNumber: 5 })));

    expect(logError).toHaveBeenCalledTimes(1);
    const input = logError.mock.calls[0][0];
    expect(input.unitNumber).toBe(5);
    expect(typeof input.unitNumber).toBe("number");
  });

  it("lecture and answer are optional", async () => {
    logError.mockResolvedValue({ entry: makeEntry(), pendingLine: null });

    const res = await post(jsonRequest(URL, newErrorBody()));

    expect(res.status).toBe(200);
    expect(logError).toHaveBeenCalledTimes(1);
    const input = logError.mock.calls[0][0];
    expect(input.lecture ?? null).toBeNull();
    expect(input.answer ?? null).toBeNull();
  });

  it("accepts null for lecture and answer (NewProblemInput allows null)", async () => {
    logError.mockResolvedValue({ entry: makeEntry(), pendingLine: null });

    const res = await post(jsonRequest(URL, newErrorBody({ lecture: null, answer: null })));

    expect(res.status).toBe(200);
    expect(logError).toHaveBeenCalledTimes(1);
  });

  describe("400 on bad input, and the service is never called", () => {
    it.each(["label", "statement", "unitNumber", "studentApproach"])("missing %s", async (field) => {
      const res = await post(jsonRequest(URL, without(newErrorBody(), field)));

      await expectErrorResponse(res, 400);
      expect(logError).not.toHaveBeenCalled();
    });

    it.each(["label", "statement", "studentApproach"])("empty %s", async (field) => {
      const res = await post(jsonRequest(URL, newErrorBody({ [field]: "" })));

      await expectErrorResponse(res, 400);
      expect(logError).not.toHaveBeenCalled();
    });

    it("non-numeric unit", async () => {
      const res = await post(jsonRequest(URL, newErrorBody({ unitNumber: "abc" })));

      await expectErrorResponse(res, 400);
      expect(logError).not.toHaveBeenCalled();
    });

    it("an empty object", async () => {
      const res = await post(jsonRequest(URL, {}));

      await expectErrorResponse(res, 400);
      expect(logError).not.toHaveBeenCalled();
    });

    it.each([
      ["malformed JSON", "{not json"],
      ["an empty body", undefined],
    ])("%s", async (_name, raw) => {
      const res = await post(rawRequest(URL, raw));

      await expectErrorResponse(res, 400);
      expect(logError).not.toHaveBeenCalled();
    });
  });

  it("500 with {error} when the service rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    logError.mockRejectedValue(new Error("db down"));

    const res = await post(jsonRequest(URL, newErrorBody()));

    await expectErrorResponse(res, 500);
  });
});

describe("GET /api/errors", () => {
  it("returns {entries} from listErrors, in the order the service gives them (newest first)", async () => {
    const newer = makeEntry({ id: "e-new", loggedOn: "2026-10-04" });
    const older = makeEntry({ id: "e-old", loggedOn: "2026-09-28" });
    listErrors.mockResolvedValue([newer, older]);

    const res = await get(new Request(URL));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    expect(await res.json()).toEqual({ entries: [newer, older] });
    expect(listErrors).toHaveBeenCalledTimes(1);
  });

  it("returns {entries: []} when nothing is logged yet", async () => {
    listErrors.mockResolvedValue([]);

    const res = await get(new Request(URL));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });

  it("500 with {error} when the service rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    listErrors.mockRejectedValue(new Error("db down"));

    const res = await get(new Request(URL));

    await expectErrorResponse(res, 500);
  });
});

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

import { POST as approvePOST } from "@/app/api/method-lines/[id]/approve/route";
import { POST as rejectPOST } from "@/app/api/method-lines/[id]/reject/route";
import { GET as listGET } from "@/app/api/method-lines/route";
import { query } from "@/lib/db";
import { approveLine, listMethodLines, rejectLine } from "@/lib/services/methodLines";
import {
  LINE_ID,
  OTHER_LINE_ID,
  asHandler,
  bareRequest,
  idContext,
  jsonRequest,
  makeLine,
  readJson,
} from "./helpers";

const list = asHandler(listGET);
const approve = asHandler(approvePOST);
const reject = asHandler(rejectPOST);

const LIST_URL = "http://test/api/method-lines";
const approveUrl = (id: string) => `http://test/api/method-lines/${id}/approve`;
const rejectUrl = (id: string) => `http://test/api/method-lines/${id}/reject`;

const listMock = vi.mocked(listMethodLines);
const approveMock = vi.mocked(approveLine);
const rejectMock = vi.mocked(rejectLine);

/** Routes may log a failure; keep the expected-error tests quiet. */
function silenceConsoleError() {
  vi.spyOn(console, "error").mockImplementation(() => {});
}

beforeEach(() => {
  vi.resetAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("method-lines routes: exports", () => {
  it("export the HTTP handlers named in the REST table", () => {
    expect(typeof listGET).toBe("function");
    expect(typeof approvePOST).toBe("function");
    expect(typeof rejectPOST).toBe("function");
  });
});

describe("GET /api/method-lines", () => {
  it("returns { lines } exactly as the service listed them", async () => {
    const lines = [
      makeLine({
        id: OTHER_LINE_ID,
        unitNumber: 1,
        status: "pending",
        origin: "error",
        errorLogId: "e1",
        source: "Error log 2026-10-01",
      }),
      makeLine({ id: LINE_ID, unitNumber: 1 }),
      makeLine({ id: "line-3", unitNumber: 2, passedAt: "2026-10-03T09:30:00.000Z" }),
    ];
    listMock.mockResolvedValue(lines);
    const res = await list(new Request(LIST_URL));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ lines });
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("returns an empty list when the sheet has no lines", async () => {
    listMock.mockResolvedValue([]);
    const res = await list(new Request(LIST_URL));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ lines: [] });
  });

  it("returns 500 with { error } when the service rejects", async () => {
    silenceConsoleError();
    listMock.mockRejectedValue(new Error("connection refused"));
    const res = await list(new Request(LIST_URL));
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("never queries the database itself", async () => {
    listMock.mockResolvedValue([makeLine()]);
    await list(new Request(LIST_URL));
    expect(query).not.toHaveBeenCalled();
  });
});

describe("POST /api/method-lines/[id]/approve", () => {
  const approved = makeLine({ id: LINE_ID, status: "active", origin: "error", errorLogId: "e1" });

  it("approves the line named in the URL and returns { line }", async () => {
    approveMock.mockResolvedValue(approved);
    const res = await approve(bareRequest(approveUrl(LINE_ID)), idContext(LINE_ID));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ line: approved });
    expect(approveMock).toHaveBeenCalledTimes(1);
    expect(approveMock).toHaveBeenCalledWith(LINE_ID);
  });

  it("uses the id from the route params, not a fixed one", async () => {
    approveMock.mockResolvedValue({ ...approved, id: OTHER_LINE_ID });
    const res = await approve(bareRequest(approveUrl(OTHER_LINE_ID)), idContext(OTHER_LINE_ID));
    expect(res.status).toBe(200);
    expect(approveMock).toHaveBeenCalledWith(OTHER_LINE_ID);
    expect(approveMock).not.toHaveBeenCalledWith(LINE_ID);
    expect((await readJson(res)).line.id).toBe(OTHER_LINE_ID);
  });

  it("does not need a request body", async () => {
    approveMock.mockResolvedValue(approved);
    const withEmptyJson = await approve(jsonRequest(approveUrl(LINE_ID), {}), idContext(LINE_ID));
    expect(withEmptyJson.status).toBe(200);
  });

  it("does not reject the line while approving it", async () => {
    approveMock.mockResolvedValue(approved);
    await approve(bareRequest(approveUrl(LINE_ID)), idContext(LINE_ID));
    expect(rejectMock).not.toHaveBeenCalled();
  });

  it("returns 409 with { error } when the line duplicates an existing one", async () => {
    silenceConsoleError();
    approveMock.mockRejectedValue(
      new Error("Duplicate of: When asked for the variance of a sum, check independence first"),
    );
    const res = await approve(bareRequest(approveUrl(LINE_ID)), idContext(LINE_ID));
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("passes the duplicate message, which names the existing trigger, through to the client", async () => {
    silenceConsoleError();
    approveMock.mockRejectedValue(
      new Error("Duplicate of: When asked for the variance of a sum, check independence first"),
    );
    const res = await approve(bareRequest(approveUrl(LINE_ID)), idContext(LINE_ID));
    const body = await readJson(res);
    expect(String(body.error)).toContain(
      "When asked for the variance of a sum, check independence first",
    );
  });

  it("returns 500 with { error } for any other failure, not 409", async () => {
    silenceConsoleError();
    approveMock.mockRejectedValue(new Error("connection refused"));
    const res = await approve(bareRequest(approveUrl(LINE_ID)), idContext(LINE_ID));
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("does not treat an unrelated database 'duplicate key' error as a duplicate line", async () => {
    silenceConsoleError();
    approveMock.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "method_lines_pkey"'),
    );
    const res = await approve(bareRequest(approveUrl(LINE_ID)), idContext(LINE_ID));
    expect(res.status).toBe(500);
  });

  it("never queries the database itself", async () => {
    approveMock.mockResolvedValue(approved);
    await approve(bareRequest(approveUrl(LINE_ID)), idContext(LINE_ID));
    expect(query).not.toHaveBeenCalled();
  });
});

describe("POST /api/method-lines/[id]/reject", () => {
  it("rejects the line named in the URL and returns { ok: true }", async () => {
    rejectMock.mockResolvedValue(undefined);
    const res = await reject(bareRequest(rejectUrl(LINE_ID)), idContext(LINE_ID));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
    expect(rejectMock).toHaveBeenCalledTimes(1);
    expect(rejectMock).toHaveBeenCalledWith(LINE_ID);
  });

  it("uses the id from the route params, not a fixed one", async () => {
    rejectMock.mockResolvedValue(undefined);
    await reject(bareRequest(rejectUrl(OTHER_LINE_ID)), idContext(OTHER_LINE_ID));
    expect(rejectMock).toHaveBeenCalledWith(OTHER_LINE_ID);
    expect(rejectMock).not.toHaveBeenCalledWith(LINE_ID);
  });

  it("does not need a request body", async () => {
    rejectMock.mockResolvedValue(undefined);
    const res = await reject(jsonRequest(rejectUrl(LINE_ID), {}), idContext(LINE_ID));
    expect(res.status).toBe(200);
    expect(await readJson(res)).toEqual({ ok: true });
  });

  it("does not approve the line while rejecting it", async () => {
    rejectMock.mockResolvedValue(undefined);
    await reject(bareRequest(rejectUrl(LINE_ID)), idContext(LINE_ID));
    expect(approveMock).not.toHaveBeenCalled();
  });

  it("returns 500 with { error } when the service rejects", async () => {
    silenceConsoleError();
    rejectMock.mockRejectedValue(new Error("connection refused"));
    const res = await reject(bareRequest(rejectUrl(LINE_ID)), idContext(LINE_ID));
    expect(res.status).toBe(500);
    const body = await readJson(res);
    expect(typeof body.error).toBe("string");
    expect(body.error.length).toBeGreaterThan(0);
  });

  it("never queries the database itself", async () => {
    rejectMock.mockResolvedValue(undefined);
    await reject(bareRequest(rejectUrl(LINE_ID)), idContext(LINE_ID));
    expect(query).not.toHaveBeenCalled();
  });
});

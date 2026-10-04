import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as errorsService from "@/lib/services/errors";
import { GET } from "@/app/api/errors/due/route";
import { asHandler, expectErrorResponse, makeEntry } from "./helpers";

vi.mock("@/lib/services/errors", () => ({
  logError: vi.fn(),
  listErrors: vi.fn(),
  dueRedrills: vi.fn(),
  answerRedrill: vi.fn(),
  logCorrectProblem: vi.fn(),
}));

const dueRedrills = vi.mocked(errorsService.dueRedrills);
const listErrors = vi.mocked(errorsService.listErrors);
const get = asHandler(GET);

const URL = "http://test/api/errors/due";
const STATEMENT = "X and Y have Var(X) = 4, Var(Y) = 9 and Cov(X, Y) = 2. Find Var(X + Y).";

beforeEach(() => {
  vi.resetAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/errors/due", () => {
  it("returns {entries} from dueRedrills, each with its problem statement", async () => {
    const due = [
      { ...makeEntry({ id: "e1", redrillOn: "2026-10-04" }), statement: STATEMENT },
      { ...makeEntry({ id: "e2", redrillOn: "2026-10-01" }), statement: "Find P(A | B) when P(A and B) = 0.2 and P(B) = 0.5." },
    ];
    dueRedrills.mockResolvedValue(due);

    const res = await get(new Request(URL));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("application/json");
    const json = await res.json();
    expect(json).toEqual({ entries: due });
    expect(json.entries[0].statement).toBe(STATEMENT);
    expect(dueRedrills).toHaveBeenCalledTimes(1);
  });

  it("asks the service for what is due (not the whole log), for today or the service default", async () => {
    dueRedrills.mockResolvedValue([]);

    await get(new Request(URL));

    expect(listErrors).not.toHaveBeenCalled();
    expect(dueRedrills).toHaveBeenCalledTimes(1);
    const [today] = dueRedrills.mock.calls[0];
    if (today !== undefined) expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("returns {entries: []} when nothing is due", async () => {
    dueRedrills.mockResolvedValue([]);

    const res = await get(new Request(URL));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [] });
  });

  it("500 with {error} when the service rejects", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    dueRedrills.mockRejectedValue(new Error("db down"));

    const res = await get(new Request(URL));

    await expectErrorResponse(res, 500);
  });
});

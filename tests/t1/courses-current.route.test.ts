import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CourseView } from "@/lib/contracts";

// Route tests: the service is mocked, so only the HTTP layer (validation, status codes, JSON shapes) is under test.
vi.mock("@/lib/services/courses", () => ({
  createCourse: vi.fn(),
  getCurrentCourse: vi.fn(),
  setCurrentUnitOverride: vi.fn(),
}));

import { GET, PATCH } from "@/app/api/courses/current/route";
import { getCurrentCourse, setCurrentUnitOverride } from "@/lib/services/courses";
import { asHandler, expectError, jsonRequest } from "./http";

const get = asHandler(GET);
const patch = asHandler(PATCH);
const URL_CURRENT = "http://test/api/courses/current";

const VIEW: CourseView = {
  course: {
    id: "course-123",
    title: "Intro to Probability",
    sourceUrl: null,
    startDate: "2026-09-14",
    endDate: "2026-10-25",
    currentUnitOverride: null,
  },
  units: [
    {
      number: 1,
      title: "Counting and Sample Spaces",
      startDate: "2026-09-14",
      endDate: "2026-09-27",
      lectures: "Lec 1-4",
      topics: "Sample spaces, counting",
      estHours: 12,
      difficulty: 3,
      difficultyReason: "Counting arguments take practice to set up.",
    },
    {
      number: 2,
      title: "Conditional Probability",
      startDate: "2026-09-28",
      endDate: "2026-10-11",
      lectures: "Lec 5-8",
      topics: "Conditioning, Bayes' rule",
      estHours: 14,
      difficulty: 4,
      difficultyReason: "Conditioning on the right event is easy to get backwards.",
    },
  ],
  weeks: [
    {
      weekNumber: 1,
      startDate: "2026-09-14",
      unitNumber: 1,
      lectures: "Lec 1-2",
      topics: "Sample spaces",
      deadlines: "Pset 1 due Fri 9/18",
      studyHours: 6,
    },
    {
      weekNumber: 2,
      startDate: "2026-09-21",
      unitNumber: 1,
      lectures: "Lec 3-4",
      topics: "Counting",
      deadlines: null,
      studyHours: 6,
    },
  ],
  currentUnit: 2,
};

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/courses/current", () => {
  it("answers 200 with the CourseView exactly as the service returned it", async () => {
    vi.mocked(getCurrentCourse).mockResolvedValue(VIEW);

    const res = await get(jsonRequest("GET", URL_CURRENT));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VIEW);
    expect(getCurrentCourse).toHaveBeenCalledTimes(1);
  });

  it("answers 404 { error } when there is no current course", async () => {
    vi.mocked(getCurrentCourse).mockResolvedValue(null);

    await expectError(await get(jsonRequest("GET", URL_CURRENT)), 404);
  });

  it("answers 500 { error } when the service throws", async () => {
    vi.mocked(getCurrentCourse).mockRejectedValue(new Error("database is down"));

    await expectError(await get(jsonRequest("GET", URL_CURRENT)), 500);
  });
});

describe("PATCH /api/courses/current", () => {
  const send = (body?: unknown) => patch(jsonRequest("PATCH", URL_CURRENT, body));

  beforeEach(() => {
    vi.mocked(setCurrentUnitOverride).mockResolvedValue(undefined);
  });

  it("sets a manual current unit and answers { ok: true }", async () => {
    const res = await send({ currentUnitOverride: 3 });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(setCurrentUnitOverride).toHaveBeenCalledTimes(1);
    expect(setCurrentUnitOverride).toHaveBeenCalledWith(3);
  });

  it("clears the override ('auto') when currentUnitOverride is null", async () => {
    const res = await send({ currentUnitOverride: null });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(setCurrentUnitOverride).toHaveBeenCalledTimes(1);
    expect(setCurrentUnitOverride).toHaveBeenCalledWith(null);
  });

  it.each<[string, unknown]>([
    ["an empty object", {}],
    ["a unit that is not a number", { currentUnitOverride: "two" }],
    ["malformed JSON", "{not json"],
    ["no body", undefined],
  ])("answers 400 { error } and never calls the service for %s", async (_name, body) => {
    await expectError(await send(body), 400);
    expect(setCurrentUnitOverride).not.toHaveBeenCalled();
  });

  it("answers 500 { error } when the service throws", async () => {
    vi.mocked(setCurrentUnitOverride).mockRejectedValue(new Error("database is down"));

    await expectError(await send({ currentUnitOverride: 2 }), 500);
  });
});

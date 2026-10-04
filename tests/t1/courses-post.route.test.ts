import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Route tests: the service is mocked, so only the HTTP layer (validation, status codes, JSON shapes) is under test.
vi.mock("@/lib/services/courses", () => ({
  createCourse: vi.fn(),
  getCurrentCourse: vi.fn(),
  setCurrentUnitOverride: vi.fn(),
}));

import { POST } from "@/app/api/courses/route";
import { createCourse } from "@/lib/services/courses";
import { asHandler, expectError, jsonRequest } from "./http";

const post = asHandler(POST);
const send = (body?: unknown) => post(jsonRequest("POST", "http://test/api/courses", body));

const SYLLABUS = "Intro to Probability. Lectures MWF. Problem sets due Fridays. Midterm Oct 9.";
const COURSE_URL = "https://stat110.example.edu/course";

type Body = { title?: string; syllabusText?: string; courseUrl?: string };

describe("POST /api/courses", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(createCourse).mockResolvedValue({ courseId: "course-123" });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each<[string, Body]>([
    ["pasted syllabus text", { syllabusText: SYLLABUS }],
    ["a course URL", { courseUrl: COURSE_URL }],
    [
      "a title, syllabus text and a URL",
      { title: "Stats 110", syllabusText: SYLLABUS, courseUrl: COURSE_URL },
    ],
  ])("creates a course from %s and answers { courseId }", async (_name, body) => {
    const res = await send(body);

    expect([200, 201]).toContain(res.status);
    expect(await res.json()).toEqual({ courseId: "course-123" });

    // the service gets exactly the parsed input: what was sent, and nothing invented for what was not
    expect(createCourse).toHaveBeenCalledTimes(1);
    const input = vi.mocked(createCourse).mock.calls[0][0];
    expect(input.title).toBe(body.title);
    expect(input.syllabusText).toBe(body.syllabusText);
    expect(input.courseUrl).toBe(body.courseUrl);
  });

  it.each<[string, unknown]>([
    ["an empty object", {}],
    ["only a title", { title: "Stats 110" }],
    ["blank syllabus text and a blank URL", { syllabusText: "", courseUrl: "" }],
    ["syllabus text that is not a string", { syllabusText: 42 }],
    ["a URL that is not a string", { courseUrl: ["https://a.example"] }],
    ["malformed JSON", "{not json"],
    ["an empty body", ""],
  ])("answers 400 { error } and never calls the service for %s", async (_name, body) => {
    await expectError(await send(body), 400);
    expect(createCourse).not.toHaveBeenCalled();
  });

  it("answers 400 { error } when there is no body at all", async () => {
    await expectError(await send(undefined), 400);
    expect(createCourse).not.toHaveBeenCalled();
  });

  it("answers 500 { error } when the service throws", async () => {
    vi.mocked(createCourse).mockRejectedValue(new Error("model exploded"));

    await expectError(await send({ syllabusText: SYLLABUS }), 500);
    expect(createCourse).toHaveBeenCalledTimes(1);
  });
});

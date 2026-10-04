import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CoursePlan, Unit } from "@/lib/contracts";

// planCourse is a pure agent: mock the model gateway and Exa, hand it a flawed model answer, check what comes out.
vi.mock("@/lib/llm", () => ({
  llmJSON: vi.fn(),
  chat: vi.fn(),
  embed: vi.fn(),
  MODELS: { smart: "s", fast: "f", embed: "e" },
}));
vi.mock("@/lib/exa", () => ({ fetchCourseText: vi.fn() }));

import { planCourse } from "@/lib/agents/planner";
import { fetchCourseText } from "@/lib/exa";
import { llmJSON } from "@/lib/llm";
import { cleanPlan, expectPlanInvariants, ISO_DATE, messyPlan } from "./fixtures";

const TODAY = "2026-09-01";
const SYLLABUS =
  "SYLLABUS-MARKER-41ab Intro to Probability. Lectures MWF, psets due Fridays, midterm Oct 9.";
const COURSE_URL = "https://stat110.example.edu/course";
const EXA_TEXT =
  "EXA-MARKER-77de Schedule: week 1 sample spaces, week 2 counting, pset 1 due Friday.";

function modelReturns(plan: CoursePlan): void {
  vi.mocked(llmJSON).mockResolvedValue(plan);
}

/** Everything the agent sent to the model (system and user text), for data-flow checks. Not about wording. */
function promptSentToModel(): string {
  const calls = vi.mocked(llmJSON).mock.calls;
  expect(calls.length, "planCourse never called llmJSON").toBeGreaterThan(0);
  return calls.map(([args]) => `${args.system}\n${args.user}`).join("\n");
}

const plan = () => planCourse({ syllabusText: SYLLABUS, today: TODAY });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(fetchCourseText).mockResolvedValue(EXA_TEXT);
  modelReturns(messyPlan());
});

describe("planCourse: invariants enforced on the model's answer", () => {
  it("numbers units from 1, in order (the model said 3, 4, 5)", async () => {
    const out = await plan();

    expect(out.units.map((u) => u.number)).toEqual([1, 2, 3]);
    expect(out.units.map((u) => u.title)).toEqual(messyPlan().units.map((u) => u.title));
  });

  it("keeps every week pointing at a real unit after renumbering", async () => {
    const out = await plan();

    const unitNumbers = out.units.map((u) => u.number);
    for (const w of out.weeks) {
      if (w.unitNumber !== null)
        expect(unitNumbers, `week ${w.weekNumber} -> unit ${w.unitNumber}`).toContain(w.unitNumber);
    }
    // weeks the model filed under its units 3, 4, 5 now belong to units 1, 2, 3
    expect(out.weeks.map((w) => w.unitNumber)).toEqual([1, 1, 2, 2, 3, 3]);
  });

  it("clamps out-of-range difficulty (7 and 0) into whole numbers 1-5 and leaves a valid 3 alone", async () => {
    const out = await plan();

    for (const u of out.units) {
      expect(Number.isInteger(u.difficulty), `unit ${u.number} difficulty ${u.difficulty}`).toBe(
        true,
      );
      expect(u.difficulty).toBeGreaterThanOrEqual(1);
      expect(u.difficulty).toBeLessThanOrEqual(5);
    }
    expect(out.units[0].difficulty).toBe(3);
  });

  it("gives a whole number from 1 to 5 even when the model sends null or a fraction", async () => {
    const model = messyPlan();
    model.units[0].difficulty = null;
    model.units[1].difficulty = 2.5;
    model.units[2].difficulty = 5.6;
    modelReturns(model);

    const out = await plan();

    for (const u of out.units) {
      expect(Number.isInteger(u.difficulty), `unit ${u.number} difficulty ${u.difficulty}`).toBe(
        true,
      );
      expect(u.difficulty).toBeGreaterThanOrEqual(1);
      expect(u.difficulty).toBeLessThanOrEqual(5);
    }
  });

  it.each<[string, (u: Unit) => void]>([
    ["0", (u) => void (u.estHours = 0)],
    ["null", (u) => void (u.estHours = null)],
    ["negative", (u) => void (u.estHours = -3)],
    ["missing", (u) => void delete (u as Partial<Unit>).estHours],
  ])(
    "gives every unit estHours > 0 when the model sent %s, and keeps valid hours",
    async (_name, breakIt) => {
      const model = messyPlan();
      model.units.forEach((u) => (u.estHours = 8));
      breakIt(model.units[1]);
      model.units[0].estHours = 12;
      modelReturns(model);

      const out = await plan();

      for (const u of out.units) {
        expect(Number.isFinite(u.estHours), `unit ${u.number} estHours ${u.estHours}`).toBe(true);
        expect(u.estHours).toBeGreaterThan(0);
      }
      expect(out.units[0].estHours).toBe(12);
    },
  );

  it.each<[string, (u: Unit) => void]>([
    ["null", (u) => void (u.difficultyReason = null)],
    ["an empty string", (u) => void (u.difficultyReason = "")],
    ["missing", (u) => void delete (u as Partial<Unit>).difficultyReason],
  ])(
    "gives every unit a difficultyReason when the model sent %s, and keeps existing ones",
    async (_name, breakIt) => {
      const model = messyPlan();
      breakIt(model.units[2]);
      modelReturns(model);

      const out = await plan();

      for (const u of out.units) {
        expect(
          typeof u.difficultyReason === "string" && u.difficultyReason.trim().length > 0,
          `unit ${u.number} difficultyReason ${JSON.stringify(u.difficultyReason)}`,
        ).toBe(true);
      }
      expect(out.units[0].difficultyReason).toBe(messyPlan().units[0].difficultyReason);
      expect(out.units[1].difficultyReason).toBe(messyPlan().units[1].difficultyReason);
    },
  );

  it("numbers weeks from 1, in order, and keeps the ISO start dates exactly", async () => {
    const out = await plan();

    expect(out.weeks.map((w) => w.weekNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.weeks.map((w) => w.startDate)).toEqual(messyPlan().weeks.map((w) => w.startDate));
    for (const w of out.weeks) expect(w.startDate).toMatch(ISO_DATE);
  });

  it("carries each week's lectures, topics, deadlines and study hours through", async () => {
    const out = await plan();

    const pick = (w: CoursePlan["weeks"][number]) => ({
      lectures: w.lectures,
      topics: w.topics,
      deadlines: w.deadlines,
      studyHours: w.studyHours,
    });
    expect(out.weeks.map(pick)).toEqual(messyPlan().weeks.map(pick));
  });

  it("keeps all the units and weeks the model produced", async () => {
    const out = await plan();

    expect(out.units).toHaveLength(3);
    expect(out.weeks).toHaveLength(6);
    expect(out.course.title.trim().length).toBeGreaterThan(0);
  });

  it("returns a plan that satisfies every invariant at once", async () => {
    expectPlanInvariants(await plan());
  });
});

describe("planCourse: where the course text comes from", () => {
  it("does not call Exa when only syllabusText is given, and sends the pasted text to the model", async () => {
    await planCourse({ syllabusText: SYLLABUS, today: TODAY });

    expect(fetchCourseText).not.toHaveBeenCalled();
    const prompt = promptSentToModel();
    expect(prompt).toContain("SYLLABUS-MARKER-41ab");
    expect(prompt).not.toContain("undefined");
  });

  it("reads the course page through Exa when courseUrl is given, and sends that text to the model", async () => {
    await planCourse({ courseUrl: COURSE_URL, today: TODAY });

    expect(fetchCourseText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchCourseText).mock.calls[0][0]).toBe(COURSE_URL);
    const prompt = promptSentToModel();
    expect(prompt).toContain("EXA-MARKER-77de");
    expect(prompt).not.toContain("undefined");
  });

  it("uses both when syllabusText and courseUrl are given", async () => {
    await planCourse({
      title: "Stats 110",
      syllabusText: SYLLABUS,
      courseUrl: COURSE_URL,
      today: TODAY,
    });

    expect(fetchCourseText).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetchCourseText).mock.calls[0][0]).toBe(COURSE_URL);
    const prompt = promptSentToModel();
    expect(prompt).toContain("SYLLABUS-MARKER-41ab");
    expect(prompt).toContain("EXA-MARKER-77de");
  });

  it("fails rather than inventing a plan when Exa throws and nothing was pasted", async () => {
    vi.mocked(fetchCourseText).mockRejectedValue(new Error("exa is down"));

    await expect(planCourse({ courseUrl: COURSE_URL, today: TODAY })).rejects.toThrow();
  });

  // Not spelled out in the issue, but a product that "reads your syllabus" must not hand the model nothing and show
  // whatever course it dreams up. The route turns the throw into a 500 { error }, which the page shows.
  it.each<[string, string]>([
    ["an empty string", ""],
    ["only whitespace", "  \n \t "],
  ])(
    "fails rather than inventing a plan when Exa returns %s and nothing was pasted",
    async (_name, text) => {
      vi.mocked(fetchCourseText).mockResolvedValue(text);

      const outcome = await planCourse({ courseUrl: COURSE_URL, today: TODAY }).then(
        () => "resolved with a plan",
        () => "rejected",
      );

      expect(
        outcome,
        "no pasted text and nothing from Exa means the model has nothing to read: planCourse must throw, not let it invent a course",
      ).toBe("rejected");
    },
  );
});

describe("planCourse: the model call", () => {
  it("plans with the smart model (or the gateway default, which is the smart model)", async () => {
    await plan();

    const [args] = vi.mocked(llmJSON).mock.calls[0];
    expect(args.model ?? "s").toBe("s");
  });

  it("hands llmJSON a zod schema that accepts a well-formed CoursePlan", async () => {
    await plan();

    // the mocked llmJSON skips validation, so check the schema itself: a real model answer in the contract shape must parse
    const [args] = vi.mocked(llmJSON).mock.calls[0];
    const parsed = args.schema.safeParse(cleanPlan());
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  it("rejects when the model call fails", async () => {
    vi.mocked(llmJSON).mockRejectedValue(new Error("gateway down"));

    await expect(plan()).rejects.toThrow();
  });
});

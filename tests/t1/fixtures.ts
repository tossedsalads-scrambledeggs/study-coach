import { expect } from "vitest";
import type { CoursePlan, MethodLineDraft, Unit } from "@/lib/contracts";

/** Shared fixtures for the T1 (planner) tests. Written from docs/PLAN.md, lib/contracts.ts and issue #2 only. */

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Three well-formed units, numbered from 1. */
export function makeUnits(): Unit[] {
  return [
    {
      number: 1,
      title: "Counting and Sample Spaces",
      startDate: "2026-09-14",
      endDate: "2026-09-27",
      lectures: "Lec 1-4",
      topics: "Sample spaces, naive probability, counting",
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
      topics: "Conditioning, Bayes' rule, independence",
      estHours: 14,
      difficulty: 4,
      difficultyReason: "Conditioning on the right event is easy to get backwards.",
    },
    {
      number: 3,
      title: "Random Variables",
      startDate: "2026-10-12",
      endDate: "2026-10-25",
      lectures: "Lec 9-12",
      topics: "PMFs, expectation, variance",
      estHours: 10,
      difficulty: 3,
      difficultyReason: "Many new definitions arrive at once.",
    },
  ];
}

/**
 * A plan as a model might plausibly hand it back: contract-shaped, but the bookkeeping is off.
 *  - units are numbered 3, 4, 5 (should become 1, 2, 3)
 *  - weeks are numbered 2..7 (should become 1..6)
 *  - difficulty is 3 (fine), 7 and 0 (out of range)
 *  - estHours is 12 (fine), 0 and null
 * Weeks still use the model's own unit numbers (3, 4, 5), two weeks per unit.
 */
export function messyPlan(): CoursePlan {
  const [a, b, c] = makeUnits();
  return {
    course: {
      title: "Intro to Probability",
      sourceUrl: null,
      startDate: "2026-09-14",
      endDate: "2026-10-25",
    },
    units: [
      { ...a, number: 3 },
      { ...b, number: 4, estHours: 0, difficulty: 7 },
      { ...c, number: 5, estHours: null, difficulty: 0 },
    ],
    weeks: [
      {
        weekNumber: 2,
        startDate: "2026-09-14",
        unitNumber: 3,
        lectures: "Lec 1-2",
        topics: "Sample spaces and naive probability",
        deadlines: "Pset 1 due Fri 9/18",
        studyHours: 6,
      },
      {
        weekNumber: 3,
        startDate: "2026-09-21",
        unitNumber: 3,
        lectures: "Lec 3-4",
        topics: "Counting",
        deadlines: "Pset 2 due Fri 9/25",
        studyHours: 6,
      },
      {
        weekNumber: 4,
        startDate: "2026-09-28",
        unitNumber: 4,
        lectures: "Lec 5-6",
        topics: "Conditional probability",
        deadlines: "Pset 3 due Fri 10/2",
        studyHours: 7,
      },
      {
        weekNumber: 5,
        startDate: "2026-10-05",
        unitNumber: 4,
        lectures: "Lec 7-8",
        topics: "Bayes' rule and independence",
        deadlines: "Midterm 1 Fri 10/9",
        studyHours: 8,
      },
      {
        weekNumber: 6,
        startDate: "2026-10-12",
        unitNumber: 5,
        lectures: "Lec 9-10",
        topics: "Random variables and PMFs",
        deadlines: "Pset 4 due Fri 10/16",
        studyHours: 6,
      },
      {
        weekNumber: 7,
        startDate: "2026-10-19",
        unitNumber: 5,
        lectures: "Lec 11-12",
        topics: "Expectation and variance",
        deadlines: "Pset 5 due Fri 10/23",
        studyHours: 6,
      },
    ],
  };
}

/** The messy plan with everything already correct: what a perfect model answer looks like. */
export function cleanPlan(): CoursePlan {
  const messy = messyPlan();
  const renumbered = new Map(messy.units.map((u, i) => [u.number, i + 1]));
  return {
    course: messy.course,
    units: messy.units.map((u, i) => ({ ...u, number: i + 1, estHours: 10, difficulty: 3 })),
    weeks: messy.weeks.map((w, i) => ({
      ...w,
      weekNumber: i + 1,
      unitNumber: w.unitNumber === null ? null : (renumbered.get(w.unitNumber) ?? null),
    })),
  };
}

/** Every invariant the issue lists for a finished plan (acceptance criteria of issue #2, planner bullet). */
export function expectPlanInvariants(plan: CoursePlan): void {
  const unitNumbers = plan.units.map((u) => u.number);
  expect(unitNumbers).toEqual(plan.units.map((_, i) => i + 1));
  for (const u of plan.units) {
    expect(Number.isInteger(u.difficulty), `unit ${u.number} difficulty ${u.difficulty}`).toBe(
      true,
    );
    expect(u.difficulty).toBeGreaterThanOrEqual(1);
    expect(u.difficulty).toBeLessThanOrEqual(5);
    expect(Number.isFinite(u.estHours), `unit ${u.number} estHours ${u.estHours}`).toBe(true);
    expect(u.estHours).toBeGreaterThan(0);
    expect(
      typeof u.difficultyReason === "string" && u.difficultyReason.trim().length > 0,
      `unit ${u.number} difficultyReason ${JSON.stringify(u.difficultyReason)}`,
    ).toBe(true);
  }
  expect(plan.weeks.map((w) => w.weekNumber)).toEqual(plan.weeks.map((_, i) => i + 1));
  for (const w of plan.weeks) {
    expect(w.startDate).toMatch(ISO_DATE);
    if (w.unitNumber !== null) expect(unitNumbers).toContain(w.unitNumber);
  }
}

/** A well-formed method-line draft; `tag` makes its text unique and easy to spot. */
export function makeDraft(unitNumber: number, lecture: string, tag: string): MethodLineDraft {
  return {
    unitNumber,
    lecture,
    trigger: `${tag}: a problem hands you a setup where the usual shortcut might not apply`,
    move: `${tag}: check the condition first, then apply the rule that matches it`,
    trap: `${tag}: applying the shortcut without checking the condition`,
    source: `U${unitNumber} ${lecture}`,
  };
}

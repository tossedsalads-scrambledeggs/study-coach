import { expect } from "vitest";
import type { DiagnoseError, ErrorLogEntry, GradeRedrill, MethodLine } from "@/lib/contracts";

/** Shared fixtures and request helpers for the T2 (error coach) tests. Not a test file. */

export const COURSE_ID = "00000000-0000-0000-0000-0000000000c1";
export const ENTRY_ID = "00000000-0000-0000-0000-0000000000e1";
export const PROBLEM_ID = "00000000-0000-0000-0000-0000000000a1";
export const LINE_ID = "00000000-0000-0000-0000-0000000000b1";

/** A method line as the model would return it: actionable inside a problem, generic to the situation. */
export const LINE = {
  trigger: "A problem asks for the variance of a sum of random variables",
  move: "Check independence first; if X and Y are dependent, add the covariance term 2Cov(X, Y)",
  trap: "Adding Var(X) + Var(Y) as if the variables were independent",
};

export function makeEntry(overrides: Partial<ErrorLogEntry> = {}): ErrorLogEntry {
  return {
    id: ENTRY_ID,
    courseId: COURSE_ID,
    problemId: PROBLEM_ID,
    loggedOn: "2026-10-04",
    weekNumber: 4,
    unitNumber: 3,
    lecture: "Lec 7",
    problemLabel: "Ex 4 - Variance of a sum",
    studentApproach: "I added the two variances: 4 + 9 = 13.",
    whatWentWrong: "You treated X and Y as independent and dropped the covariance term.",
    correctApproach: "Var(X + Y) = Var(X) + Var(Y) + 2Cov(X, Y) = 4 + 9 + 4 = 17.",
    errorTypes: ["concept_gap"],
    primaryErrorType: "concept_gap",
    lesson: "Check independence before adding variances.",
    redrillOn: "2026-10-06",
    cleared: false,
    clearedOn: null,
    methodLineId: LINE_ID,
    ...overrides,
  };
}

export function makePendingLine(overrides: Partial<MethodLine> = {}): MethodLine {
  return {
    id: LINE_ID,
    courseId: COURSE_ID,
    unitNumber: 3,
    lecture: "Lec 7",
    ...LINE,
    source: "Error log 2026-10-04",
    origin: "error",
    status: "pending",
    errorLogId: ENTRY_ID,
    passedAt: null,
    ...overrides,
  };
}

/** A valid body for POST /api/errors (NewProblemInput & { studentApproach }). */
export function newErrorBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    label: "Ex 4 - Variance of a sum",
    statement: "X and Y have Var(X) = 4, Var(Y) = 9 and Cov(X, Y) = 2. Find Var(X + Y).",
    unitNumber: 3,
    studentApproach: "I added the two variances: 4 + 9 = 13.",
    ...overrides,
  };
}

/** A valid body for POST /api/problems/correct (NewProblemInput, no student approach). */
export function correctProblemBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { studentApproach: _unused, ...rest } = newErrorBody();
  return { ...rest, ...overrides };
}

export function without(body: Record<string, unknown>, key: string): Record<string, unknown> {
  const copy = { ...body };
  delete copy[key];
  return copy;
}

export function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** A POST whose body is sent as-is (use it for malformed or missing JSON). */
export function rawRequest(url: string, raw?: string): Request {
  return new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: raw });
}

/**
 * Call a route handler without caring whether it declares (req), (req, ctx) or no parameters,
 * and turn a synchronous throw into a rejection.
 */
export function asHandler(fn: unknown): (...args: unknown[]) => Promise<Response> {
  return async (...args: unknown[]) => (fn as (...a: unknown[]) => Response | Promise<Response>)(...args);
}

/** The route answered `status` with a JSON body `{ error: "<non-empty message>" }`. */
export async function expectErrorResponse(res: Response, status: number): Promise<void> {
  expect(res.status).toBe(status);
  expect(res.headers.get("content-type") ?? "").toContain("application/json");
  const body = (await res.json()) as { error?: unknown };
  expect(typeof body.error).toBe("string");
  expect((body.error as string).length).toBeGreaterThan(0);
}

export type DiagnoseInput = Parameters<DiagnoseError>[0];
export type GradeInput = Parameters<GradeRedrill>[0];

export function diagnoseInput(overrides: Partial<DiagnoseInput> = {}): DiagnoseInput {
  return {
    problem: {
      label: "Ex 4 - Variance of a sum",
      statement: "X and Y have Var(X) = 4, Var(Y) = 9 and Cov(X, Y) = 2. Find Var(X + Y).",
      unitNumber: 3,
      lecture: "Lec 7",
      answer: "Var(X + Y) = 17",
    },
    studentApproach: "I added the two variances: 4 + 9 = 13.",
    courseTitle: "Introduction to Probability",
    existingLines: [],
    ...overrides,
  };
}

/** What the model returns for a diagnosis (before the agent enforces its invariants). */
export function rawDiagnosis(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    whatWentWrong: "You added Var(X) and Var(Y) and left out the covariance term.",
    correctApproach: "Var(X + Y) = Var(X) + Var(Y) + 2Cov(X, Y) = 4 + 9 + 2 * 2 = 17.",
    errorTypes: ["concept_gap"],
    primaryErrorType: "concept_gap",
    lesson: "Before adding variances, check whether the variables are independent.",
    methodLine: { ...LINE },
    ...overrides,
  };
}

export function gradeInput(overrides: Partial<GradeInput> = {}): GradeInput {
  return {
    problem: {
      statement: "X and Y have Var(X) = 4, Var(Y) = 9 and Cov(X, Y) = 2. Find Var(X + Y).",
      answer: "Var(X + Y) = 17",
    },
    correctApproach: "Var(X + Y) = Var(X) + Var(Y) + 2Cov(X, Y) = 4 + 9 + 2 * 2 = 17.",
    studentAnswer: "I get 4 + 9 + 2(2), which is 17.",
    ...overrides,
  };
}

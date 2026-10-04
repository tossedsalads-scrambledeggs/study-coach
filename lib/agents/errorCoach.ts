import { z } from "zod";
import { ERROR_TYPES, ERROR_TYPE_LABELS } from "@/lib/contracts";
import type { DiagnoseError, Diagnosis, ErrorType, GradeRedrill } from "@/lib/contracts";
import { llmJSON, MODELS } from "@/lib/llm";
import { needsMethodLine } from "@/lib/rules";

/**
 * Error coach agents: pure functions of their inputs. One model call each, through lib/llm.ts.
 * The model is asked for exactly the contract shape; the invariants are then enforced in code.
 */

// ---------------------------------------------------------------------------
// Diagnosis
// ---------------------------------------------------------------------------

// Deliberately lenient on the error-type strings: invalid or duplicate types are cleaned up in code
// rather than costing a retry.
const diagnosisSchema = z.object({
  whatWentWrong: z.string().min(1),
  correctApproach: z.string().min(1),
  errorTypes: z.array(z.string()),
  primaryErrorType: z.string(),
  lesson: z.string().min(1),
  methodLine: z
    .object({ trigger: z.string().optional(), move: z.string().optional(), trap: z.string().optional() })
    .nullish(),
});

const ERROR_TYPE_DEFINITIONS: Record<ErrorType, string> = {
  concept_gap: "misunderstands what an idea means or when it applies",
  computational_slip: "right method, arithmetic or algebra mistake",
  wrong_tool: "knows the concepts but reached for a formula or technique that doesn't fit",
  misread_setup:
    "solved a different problem than the one asked (missed a condition, misread what X counts)",
};

const errorTypeList = ERROR_TYPES.map(
  (t) => `- ${t} (${ERROR_TYPE_LABELS[t].toLowerCase()}): ${ERROR_TYPE_DEFINITIONS[t]}`,
).join("\n");

const DIAGNOSE_SYSTEM = `You are the error coach inside a study app. A student got a problem wrong and shows you how they approached it. Find exactly where their reasoning went wrong, explain it in plain words, write the correct approach step by step, and turn the mistake into something they can reuse.

How to work
1. Solve the problem yourself first, carefully. If a reference answer is given, treat it as the truth and make sure your correct approach reaches it.
2. Compare the student's approach to the correct one, step by step. Name the first step where it went off and what they did instead. Quote or paraphrase their actual step. If their approach is too thin to pin down the error, say what is missing and give your best reading.
3. Classify the mistake with these error types (use the exact keys):
${errorTypeList}
List every type that applies (most mistakes have one, some have two), and pick one primary: the type that, if fixed, would have prevented the mistake. primaryErrorType must be one of the types you list.

Fields
- whatWentWrong: 2 to 4 plain sentences addressed to the student ("you"). Say what they did and why it fails. No jargon beyond the course's own terms.
- correctApproach: the correct solution as numbered steps, one step per line ("1. ...", "2. ..."). Show the reasoning, not just the result, and end with the final answer.
- lesson: ONE reusable sentence, the fix, that helps on any similar problem. It must not depend on this problem's numbers or names.
- methodLine: a row for the student's method sheet (Trigger, Move, Trap), described below.
Write maths as plain text (e.g. P(A ∩ B), 1/2^n, sqrt(x)), never LaTeX or $...$. This applies to every field, including the method line.

Method line
RULE: a line must be actionable inside a problem, not true-in-general.
"Var(X) = E[X^2] - (E[X])^2" is NOT a line, it is a fact that is true in general. "When asked for the variance of a SUM, check independence FIRST, otherwise the covariance term is live" IS a line, because it tells you what to do when you see a situation inside a problem.
Lines are generic to the situation, never about one specific problem: no numbers, names or scenarios taken from this problem.
- trigger: the situation inside a problem that should fire this move, what the student sees or is asked, phrased in general ("When asked for ...", "When a problem gives ..."). One sentence.
- move: what to do, concretely, written as an instruction. One sentence.
- trap: the tempting wrong move, the one this mistake fell into. One sentence.
Write a method line whenever any error type other than computational_slip applies. Set methodLine to null only when computational_slip is the only error type.
The student already has the method lines listed in the message. Yours must not be a near-copy of any of them: the same trigger, or the same move in different words, counts as a copy. If an existing line already covers the situation, write yours for the specific failure you saw, with a sharper trigger or a different move.

Respond with exactly this JSON shape:
{
  "whatWentWrong": string,
  "correctApproach": string,
  "errorTypes": array of "concept_gap" | "computational_slip" | "wrong_tool" | "misread_setup",
  "primaryErrorType": one of the types in errorTypes,
  "lesson": string,
  "methodLine": { "trigger": string, "move": string, "trap": string } or null
}`;

type DiagnoseInput = Parameters<DiagnoseError>[0];

function diagnosisPrompt(input: DiagnoseInput): string {
  const { problem, studentApproach, courseTitle, existingLines } = input;
  const where = [`Unit ${problem.unitNumber}`, problem.lecture].filter(Boolean).join(", ");
  const answer = problem.answer?.trim()
    ? `Reference answer: ${problem.answer.trim()}`
    : "Reference answer: none given. Work it out yourself carefully.";
  const lines =
    existingLines.length > 0
      ? existingLines.map((l) => `- When ${l.trigger} -> ${l.move}`).join("\n")
      : "(none yet)";
  return [
    `Course: ${courseTitle}`,
    `Where: ${where}`,
    `Problem (${problem.label}):`,
    problem.statement,
    answer,
    "",
    "Student's approach:",
    studentApproach,
    "",
    "Existing method lines (do not duplicate):",
    lines,
  ].join("\n");
}

/** "Concept gap", "concept-gap" and "concept_gap" all mean the same type. */
function toErrorType(value: unknown): ErrorType | null {
  if (typeof value !== "string") return null;
  const key = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return (ERROR_TYPES as readonly string[]).includes(key) ? (key as ErrorType) : null;
}

export const diagnoseError: DiagnoseError = async (input) => {
  const out = await llmJSON({
    system: DIAGNOSE_SYSTEM,
    user: diagnosisPrompt(input),
    schema: diagnosisSchema,
    model: MODELS.smart,
  });

  // Keep only the four valid types, once each, in the order the model gave them.
  const errorTypes: ErrorType[] = [];
  for (const raw of out.errorTypes ?? []) {
    const t = toErrorType(raw);
    if (t && !errorTypes.includes(t)) errorTypes.push(t);
  }

  // The primary type is always one of errorTypes: add it if the model left it out.
  let primaryErrorType = toErrorType(out.primaryErrorType);
  if (primaryErrorType == null) primaryErrorType = errorTypes[0] ?? null;
  if (primaryErrorType == null) throw new Error("The model did not name a valid error type");
  if (!errorTypes.includes(primaryErrorType)) errorTypes.push(primaryErrorType);

  // A method line exists exactly when the rule says so.
  let methodLine: Diagnosis["methodLine"] = null;
  if (needsMethodLine(errorTypes)) {
    const line = out.methodLine;
    const trigger = line?.trigger?.trim();
    const move = line?.move?.trim();
    const trap = line?.trap?.trim();
    if (!trigger || !move || !trap) {
      throw new Error("The model did not write a method line for this mistake");
    }
    methodLine = { trigger, move, trap };
  }

  return {
    whatWentWrong: String(out.whatWentWrong ?? "").trim(),
    correctApproach: String(out.correctApproach ?? "").trim(),
    errorTypes,
    primaryErrorType,
    lesson: String(out.lesson ?? "").trim(),
    methodLine,
  };
};

// ---------------------------------------------------------------------------
// Re-drill grading
// ---------------------------------------------------------------------------

const gradeSchema = z.object({ passed: z.boolean(), feedback: z.string() });

const GRADE_SYSTEM = `You grade a student's re-drill: they are re-solving a problem they got wrong earlier. You are given the problem, the reference answer when there is one, the correct approach, and the student's answer.

The student passes only if BOTH hold:
1. Their answer follows the correct approach: the key steps of the method are there, in substance. A different method that is valid and sound counts. Repeating the mistake from before does not.
2. It reaches the right result. Check it against the reference answer if given, otherwise against the correct approach.
A right number with no sign of the method, or reached by the wrong method, does not pass. A sound method with an arithmetic slip in the result does not pass either; say so kindly. Working does not need to be long, but the key step must be visible or unmistakable from what they wrote.

Feedback is one to three plain sentences, addressed to the student. If they passed, say what they got right. If not, say exactly what is off and what to do next, without handing over the full solution.
Write maths as plain text (e.g. P(A ∩ B), 1/2^n, sqrt(x)), never LaTeX or $...$.

Respond with exactly this JSON shape:
{ "passed": boolean, "feedback": string }`;

export const gradeRedrill: GradeRedrill = async (input) => {
  const { problem, correctApproach, studentAnswer } = input;
  const reference = problem.answer?.trim()
    ? problem.answer.trim()
    : "none given, so use the correct approach to decide what the right result is";
  const user = [
    "Problem:",
    problem.statement,
    "",
    `Reference answer: ${reference}`,
    "",
    "Correct approach:",
    correctApproach,
    "",
    "Student's answer:",
    studentAnswer,
  ].join("\n");

  const out = await llmJSON({
    system: GRADE_SYSTEM,
    user,
    schema: gradeSchema,
    model: MODELS.fast,
  });
  return { passed: out.passed === true, feedback: String(out.feedback ?? "").trim() };
};

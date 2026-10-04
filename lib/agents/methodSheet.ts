import { z } from "zod";
import type { MethodLineDraft, SeedMethodLines } from "@/lib/contracts";
import { llmJSON, MODELS } from "@/lib/llm";

/**
 * Method-sheet agent: seeds 2-4 method lines per unit from the course outline (and material, if any).
 * One model call; the output is filtered and tidied in code. Never touches the database.
 *
 * THE RULE: a line must be actionable inside a problem, not true-in-general. Trigger = a situation
 * inside a problem, move = a concrete action, trap = the tempting wrong move. Generic to the
 * situation, never about one specific problem.
 */

const MAX_LINES_PER_UNIT = 4;
const MAX_MATERIAL_CHARS = 30_000;

const lineSchema = z.object({
  unitNumber: z.union([z.number(), z.string()]),
  lecture: z.string().nullish(),
  trigger: z.string(),
  move: z.string(),
  trap: z.string(),
  source: z.string().nullish(),
});

const linesSchema = z.object({ lines: z.array(lineSchema) });

const SYSTEM = `You write the METHOD SHEET for a course: short, reusable "when you see this in a problem, do this" lines that a student uses while solving problems.

Each line has:
- trigger: a situation you can recognise INSIDE a problem (what it asks or what it looks like). Example: "A problem asks for the variance of a SUM of random variables".
- move: the concrete action to take, in the imperative. Example: "Check independence FIRST; if the variables are not independent, the covariance term is live".
- trap: the tempting wrong move in that situation. Example: "Adding the variances without checking independence".
- source: where in the course it comes from: unit, then lecture. Example: "U4 Lec 11".

THE RULE: a line must be actionable inside a problem, not true-in-general.
- NOT a line: "Var(X) = E[X^2] - (E[X])^2" (a fact), definitions, theorems, or advice like "be careful", "understand the concept" or "check your work".
- IS a line: the trigger, move and trap examples above.
Lines are generic to the situation: never about one specific problem, number or named example. Another problem with the same situation must fire the same line.

Write 2 or 3 lines for EVERY unit (4 only for a clearly harder unit), each covering a different situation, grounded in the unit's lectures and topics. Keep the whole sheet under 24 lines: with many units, write 2 per unit. Adapt to the subject: for a programming course, situations in code or a spec; for a proof course, situations in a statement to prove.
Keep every field short, under 20 words, and write nothing outside the JSON.

Return one JSON object: {"lines": [{"unitNumber": 4, "trigger": string, "move": string, "trap": string, "source": "U4 Lec 11"}]}. unitNumber must be one of the unit numbers listed below.`;

function toInt(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? Math.trunc(value) : null;
  if (typeof value === "string") {
    const m = value.match(/-?\d+/);
    return m ? Number(m[0]) : null;
  }
  return null;
}

/** One line of plain text, or null when empty. */
function oneLine(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const s = value.replace(/\s+/g, " ").trim();
  return s ? s : null;
}

type Lines = z.infer<typeof linesSchema>;

/**
 * One model call with the smart model. The AI Gateway answers 504 when a model takes over a minute, so on
 * that error (and only that one) ask once more with the fast model, which finishes in a fraction of the time.
 */
async function askModel(args: { system: string; user: string; schema: z.ZodType<Lines> }): Promise<Lines> {
  try {
    return await llmJSON({ ...args, model: MODELS.smart });
  } catch (err) {
    if (!/AI Gateway 504|took too long/i.test(err instanceof Error ? err.message : String(err))) throw err;
    return await llmJSON({ ...args, model: MODELS.fast });
  }
}

function lectureFromSource(source: string | null): string | null {
  const m = source?.match(/\bLec(?:ture)?s?\.?\s*\d[\d\s,\-–]*/i);
  return m ? m[0].replace(/[\s,]+$/, "").trim() : null;
}

export const seedMethodLines: SeedMethodLines = async ({ courseTitle, units, materials }) => {
  if (units.length === 0) return [];

  const outline = units
    .map((u) => {
      const parts = [`Unit ${u.number}: ${u.title}`];
      if (u.lectures) parts.push(`lectures: ${u.lectures}`);
      if (u.topics) parts.push(`topics: ${u.topics}`);
      if (u.difficulty != null) parts.push(`difficulty ${u.difficulty}/5`);
      return parts.join(" | ");
    })
    .join("\n");

  const material = materials?.trim().slice(0, MAX_MATERIAL_CHARS);
  const user = [
    `Course: ${courseTitle}`,
    "",
    "UNITS",
    outline,
    ...(material
      ? ["", "COURSE MATERIAL (use it to choose lectures and sources; it may be long)", "<<<", material, ">>>"]
      : []),
  ].join("\n");

  const result = await askModel({ system: SYSTEM, user, schema: linesSchema });

  const byNumber = new Map(units.map((u) => [u.number, u]));
  const perUnit = new Map<number, number>();
  const seen = new Set<string>();
  const drafts: MethodLineDraft[] = [];

  for (const line of result?.lines ?? []) {
    const unitNumber = toInt(line?.unitNumber);
    const unit = unitNumber != null ? byNumber.get(unitNumber) : undefined;
    if (!unit) continue;

    const trigger = oneLine(line.trigger);
    const move = oneLine(line.move);
    const trap = oneLine(line.trap);
    if (!trigger || !move || !trap) continue;

    const key = `${unit.number}|${trigger.toLowerCase()}`;
    if (seen.has(key)) continue;
    if ((perUnit.get(unit.number) ?? 0) >= MAX_LINES_PER_UNIT) continue;
    seen.add(key);
    perUnit.set(unit.number, (perUnit.get(unit.number) ?? 0) + 1);

    const givenSource = oneLine(line.source);
    const lecture = oneLine(line.lecture) ?? lectureFromSource(givenSource);
    drafts.push({
      unitNumber: unit.number,
      lecture,
      trigger,
      move,
      trap,
      source: givenSource ?? `U${unit.number}${lecture ? ` ${lecture}` : ""}`,
    });
  }

  return drafts;
};

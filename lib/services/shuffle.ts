import { gradeVariant, makeVariant } from "@/lib/agents/shuffle";
import { STUDENT_ID, type ShuffleService } from "@/lib/contracts";
import { query } from "@/lib/db";
import { todayISO } from "@/lib/rules";
import { logError } from "@/lib/services/errors";

/**
 * Shuffle pile: serve a fresh variant of a waiting problem, grade the answer, clear the item or log the miss.
 * The routes show the student only the messages thrown on purpose below ("No course yet", "... was not found",
 * "... does not belong ..."; see app/api/shuffle/shared.ts). Any other error becomes a generic message.
 */

interface ProblemRow {
  unit_number: number;
  lecture: string | null;
  label: string;
  statement: string;
  answer: string | null;
}

interface VariantRow extends ProblemRow {
  parent_problem_id: string | null;
}

/** One row per graded answer; the pass path runs it inside a CTE, so its parameters are $1 to $6. */
const INSERT_ATTEMPT = `insert into attempts (course_id, kind, problem_id, question, student_answer, passed, feedback)
     values ($1, 'shuffle', $2, $3, $4, $5, $6)`;

async function currentCourseId(): Promise<string> {
  const [course] = await query<{ id: string }>(
    "select * from courses where student_id = $1 order by created_at desc limit 1",
    [STUDENT_ID],
  );
  if (!course) throw new Error("No course yet");
  return course.id;
}

/** A variant is stored as "answer\n\nsolution" in problems.answer; split it back apart for grading. */
function splitStoredAnswer(stored: string | null): { answer: string; solution: string } {
  const text = stored ?? "";
  const gap = text.indexOf("\n\n");
  if (gap < 0) return { answer: text.trim(), solution: "" };
  return { answer: text.slice(0, gap).trim(), solution: text.slice(gap + 2).trim() };
}

export const nextShuffleProblem: ShuffleService["nextShuffleProblem"] = async () => {
  const courseId = await currentCourseId();

  const [item] = await query<{ id: string; problem_id: string }>(
    "select * from shuffle_pile where course_id = $1 and status = 'waiting' order by random() limit 1",
    [courseId],
  );
  if (!item) return null;

  const [original] = await query<ProblemRow>("select * from problems where id = $1", [item.problem_id]);
  if (!original) throw new Error("The shuffle item's problem is missing");

  const [logged] = await query<{ lesson: string }>(
    "select lesson from error_log where problem_id = $1 order by created_at desc limit 1",
    [item.problem_id],
  );
  const earlier = await query<{ statement: string }>(
    "select statement from problems where parent_problem_id = $1 order by created_at",
    [item.problem_id],
  );

  const variant = await makeVariant({
    problem: {
      statement: original.statement,
      answer: original.answer,
      unitNumber: original.unit_number,
      lecture: original.lecture,
    },
    lesson: logged?.lesson ?? null,
    previousVariants: earlier.map((r) => r.statement),
  });

  // A variant that failed and came back through the error log is already labelled "(shuffle)"; don't stack it.
  const baseLabel = original.label.replace(/\s*\(shuffle\)\s*$/i, "");
  const [saved] = await query<{ id: string }>(
    `insert into problems (course_id, unit_number, lecture, label, statement, answer, origin, parent_problem_id)
     values ($1, $2, $3, $4, $5, $6, 'shuffle', $7) returning id`,
    [
      courseId,
      original.unit_number,
      original.lecture,
      `${baseLabel} (shuffle)`,
      variant.statement,
      `${variant.answer}\n\n${variant.solution}`,
      item.problem_id,
    ],
  );
  if (!saved) throw new Error("Could not save the shuffle problem");

  // Never send the answer or solution to the student.
  return { itemId: item.id, problemId: saved.id, statement: variant.statement };
};

export const answerShuffle: ShuffleService["answerShuffle"] = async ({ itemId, problemId, answer }) => {
  const courseId = await currentCourseId();

  const [variant] = await query<VariantRow>(
    "select * from problems where id = $1 and course_id = $2 and origin = 'shuffle'",
    [problemId, courseId],
  );
  if (!variant) throw new Error("That shuffle problem was not found");

  // The ids travel through the chat, so check they belong together before grading or clearing anything.
  const [item] = await query<{ id: string }>("select id from shuffle_pile where id = $1 and problem_id = $2", [
    itemId,
    variant.parent_problem_id,
  ]);
  if (!item) throw new Error("That problem does not belong to that shuffle item");

  const stored = splitStoredAnswer(variant.answer);
  const grade = await gradeVariant({
    variant: { statement: variant.statement, answer: stored.answer, solution: stored.solution },
    studentAnswer: answer,
  });

  const attempt = [courseId, problemId, variant.statement, answer, grade.passed, grade.feedback];

  if (grade.passed) {
    // One statement, so the attempt and the clearing are saved together or not at all. The status guard keeps a
    // second, late pass from moving the cleared date.
    await query(
      `with attempt as (${INSERT_ATTEMPT})
       update shuffle_pile set status = 'fully_cleared', fully_cleared_on = $7 where id = $8 and status = 'waiting'`,
      [...attempt, todayISO(), itemId],
    );
    return { passed: true, feedback: grade.feedback, errorLogId: null };
  }

  await query(INSERT_ATTEMPT, attempt);

  // A miss on the variant is diagnosed like any other error; the student's answer is their approach.
  const { entry } = await logError({
    label: variant.label,
    statement: variant.statement,
    unitNumber: variant.unit_number,
    lecture: variant.lecture,
    answer: variant.answer,
    studentApproach: answer,
  });
  return { passed: false, feedback: grade.feedback, errorLogId: entry.id };
};

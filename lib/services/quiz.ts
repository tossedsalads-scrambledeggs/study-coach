import { gradeQuizAnswer, writeQuizQuestion } from "@/lib/agents/methodQuiz";
import type { Grade, ISODate, QuizQuestion } from "@/lib/contracts";
import { db, query } from "@/lib/db";
import { currentUnit, pickQuizLine, todayISO } from "@/lib/rules";
import { METHOD_LINE_COLUMNS, currentCourse, toMethodLine } from "@/lib/services/methodLines";
import type { CourseRow, MethodLineRow } from "@/lib/services/methodLines";

/** How many earlier questions for a line the question writer is told to avoid repeating. */
const RECENT_QUESTIONS = 5;

/** A query function tied to one connection, so a group of statements shares one transaction. */
type Query = <T = Record<string, unknown>>(text: string, params?: unknown[]) => Promise<T[]>;

/**
 * Run a sequence of writes atomically on one pooled connection: commit when `work` resolves, roll back
 * when it throws. Keep model calls and plain reads outside, since the connection is held until `work` ends.
 */
async function withTransaction<T>(work: (q: Query) => Promise<T>): Promise<T> {
  const client = await db().connect();
  let broken: Error | undefined;
  // The pool does not listen to a client that is checked out, so a dropped connection would otherwise
  // surface as an unhandled 'error' event and take the process down. Remember it and discard the client.
  const onError = (err: Error) => {
    broken = err;
  };
  client.on("error", onError);
  try {
    await client.query("begin");
    const q: Query = async <R>(text: string, params: unknown[] = []) =>
      (await client.query(text, params)).rows as R[];
    const result = await work(q);
    await client.query("commit");
    return result;
  } catch (err) {
    try {
      await client.query("rollback");
    } catch (rollbackErr) {
      // Unknown connection state: have the pool discard it rather than hand it out again.
      broken = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
    }
    throw err;
  } finally {
    client.removeListener("error", onError);
    client.release(broken);
  }
}

interface UnitRow {
  number: number;
  start_date: Date | string | null;
}

function toISODate(value: Date | string | null): ISODate | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function currentUnitNumber(course: CourseRow): Promise<number> {
  const units = await query<UnitRow>(
    "select number, start_date::text as start_date from units where course_id = $1 order by number",
    [course.id],
  );
  return currentUnit(
    units.map((u) => ({ number: u.number, startDate: toISODate(u.start_date) })),
    todayISO(),
    course.current_unit_override,
  );
}

/** A random approved, unpassed line from a unit the student has reached, asked as a fresh scenario. */
export async function nextQuizQuestion(): Promise<QuizQuestion | null> {
  const course = await currentCourse();
  if (!course) return null;

  const current = await currentUnitNumber(course);
  const lineRows = await query<MethodLineRow>(
    `select ${METHOD_LINE_COLUMNS} from method_lines where course_id = $1`,
    [course.id],
  );
  const lastAsked = await query<{ method_line_id: string | null }>(
    "select method_line_id from attempts where course_id = $1 and kind = 'quiz' order by created_at desc limit 1",
    [course.id],
  );

  const line = pickQuizLine(lineRows.map(toMethodLine), current, lastAsked[0]?.method_line_id ?? null);
  if (!line) return null;

  const recent = await query<{ question: string }>(
    `select question from attempts where method_line_id = $1 and kind = 'quiz' order by created_at desc limit ${RECENT_QUESTIONS}`,
    [line.id],
  );
  const question = await writeQuizQuestion(
    line,
    recent.map((r) => r.question),
  );
  return { methodLineId: line.id, unitNumber: line.unitNumber, question };
}

/** Grade an answer, record the attempt, and retire the line on its first pass. */
export async function answerQuiz(input: { methodLineId: string; question: string; answer: string }): Promise<Grade> {
  const found = await query<MethodLineRow>(`select ${METHOD_LINE_COLUMNS} from method_lines where id = $1`, [
    input.methodLineId,
  ]);
  if (!found[0]) throw new Error("Method line not found");
  const line = toMethodLine(found[0]);

  const grade = await gradeQuizAnswer(line, input.question, input.answer);

  // Both writes land together or not at all: a pass never retires a line without its attempt on record.
  await withTransaction(async (q) => {
    await q(
      `insert into attempts (course_id, kind, method_line_id, question, student_answer, passed, feedback)
       values ($1, 'quiz', $2, $3, $4, $5, $6)`,
      [line.courseId, line.id, input.question, input.answer, grade.passed, grade.feedback],
    );
    if (grade.passed) {
      await q("update method_lines set passed_at = now() where id = $1 and passed_at is null", [line.id]);
    }
  });
  return grade;
}

/** Per unit: how many approved lines there are and how many the student has passed. */
export async function quizTracker(): Promise<{ byUnit: { unitNumber: number; total: number; passed: number }[] }> {
  const course = await currentCourse();
  if (!course) return { byUnit: [] };

  const rows = await query<Pick<MethodLineRow, "unit_number" | "passed_at">>(
    "select unit_number, passed_at from method_lines where course_id = $1 and status = 'active'",
    [course.id],
  );
  const units = new Map<number, { unitNumber: number; total: number; passed: number }>();
  for (const row of rows) {
    const unit = units.get(row.unit_number) ?? { unitNumber: row.unit_number, total: 0, passed: 0 };
    unit.total += 1;
    if (row.passed_at != null) unit.passed += 1;
    units.set(row.unit_number, unit);
  }
  return { byUnit: [...units.values()].sort((a, b) => a.unitNumber - b.unitNumber) };
}

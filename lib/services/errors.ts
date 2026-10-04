import { diagnoseError, gradeRedrill } from "@/lib/agents/errorCoach";
import { STUDENT_ID } from "@/lib/contracts";
import type {
  ErrorLogEntry,
  ErrorType,
  ErrorsService,
  Grade,
  ISODate,
  MethodLine,
  NewProblemInput,
} from "@/lib/contracts";
import { db, query } from "@/lib/db";
import { currentUnit, redrillDate, todayISO } from "@/lib/rules";

/**
 * Error log service: DB + the error coach agents. Acts on the student's latest course.
 * Dates leave this file as "YYYY-MM-DD" strings.
 */

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

/** Postgres `date` -> "YYYY-MM-DD". SQL below casts to text; this also copes with a Date. */
function isoDate(value: unknown): ISODate | null {
  if (value == null) return null;
  if (value instanceof Date) {
    // node-postgres builds `date` values at local midnight; anything else is read as UTC.
    const localMidnight =
      value.getHours() === 0 &&
      value.getMinutes() === 0 &&
      value.getSeconds() === 0 &&
      value.getMilliseconds() === 0;
    const y = localMidnight ? value.getFullYear() : value.getUTCFullYear();
    const m = (localMidnight ? value.getMonth() : value.getUTCMonth()) + 1;
    const d = localMidnight ? value.getDate() : value.getUTCDate();
    return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return String(value).slice(0, 10);
}

function isoTimestamp(value: unknown): string | null {
  if (value == null) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

interface EntryRow {
  id: string;
  course_id: string;
  problem_id: string;
  logged_on: unknown;
  week_number: number | null;
  unit_number: number;
  lecture: string | null;
  problem_label?: string | null;
  student_approach: string;
  what_went_wrong: string;
  correct_approach: string;
  error_types: ErrorType[];
  primary_error_type: ErrorType;
  lesson: string;
  redrill_on: unknown;
  cleared: boolean;
  cleared_on: unknown;
  method_line_id: string | null;
}

/** Map a row to the contract type. `fb` fills anything the row lacks (used for rows we just inserted). */
function toEntry(row: Partial<EntryRow>, fb: Partial<ErrorLogEntry> = {}): ErrorLogEntry {
  return {
    id: (row.id ?? fb.id) as string,
    courseId: (row.course_id ?? fb.courseId) as string,
    problemId: (row.problem_id ?? fb.problemId) as string,
    loggedOn: isoDate(row.logged_on) ?? fb.loggedOn ?? "",
    weekNumber: row.week_number ?? fb.weekNumber ?? null,
    unitNumber: (row.unit_number ?? fb.unitNumber) as number,
    lecture: row.lecture ?? fb.lecture ?? null,
    problemLabel: row.problem_label ?? fb.problemLabel ?? "",
    studentApproach: (row.student_approach ?? fb.studentApproach) as string,
    whatWentWrong: (row.what_went_wrong ?? fb.whatWentWrong) as string,
    correctApproach: (row.correct_approach ?? fb.correctApproach) as string,
    errorTypes: row.error_types ?? fb.errorTypes ?? [],
    primaryErrorType: (row.primary_error_type ?? fb.primaryErrorType) as ErrorType,
    lesson: (row.lesson ?? fb.lesson) as string,
    redrillOn: isoDate(row.redrill_on) ?? fb.redrillOn ?? "",
    cleared: row.cleared ?? fb.cleared ?? false,
    clearedOn: isoDate(row.cleared_on) ?? fb.clearedOn ?? null,
    methodLineId: row.method_line_id ?? fb.methodLineId ?? null,
  };
}

interface MethodLineRow {
  id: string;
  course_id: string;
  unit_number: number;
  lecture: string | null;
  trigger: string;
  move: string;
  trap: string;
  source: string | null;
  origin: MethodLine["origin"];
  status: MethodLine["status"];
  error_log_id: string | null;
  passed_at: unknown;
}

function toMethodLine(row: Partial<MethodLineRow>, fb: Partial<MethodLine> = {}): MethodLine {
  return {
    id: (row.id ?? fb.id) as string,
    courseId: (row.course_id ?? fb.courseId) as string,
    unitNumber: (row.unit_number ?? fb.unitNumber) as number,
    lecture: row.lecture ?? fb.lecture ?? null,
    trigger: (row.trigger ?? fb.trigger) as string,
    move: (row.move ?? fb.move) as string,
    trap: (row.trap ?? fb.trap) as string,
    source: row.source ?? fb.source ?? null,
    origin: (row.origin ?? fb.origin) as MethodLine["origin"],
    status: (row.status ?? fb.status) as MethodLine["status"],
    errorLogId: row.error_log_id ?? fb.errorLogId ?? null,
    passedAt: isoTimestamp(row.passed_at) ?? fb.passedAt ?? null,
  };
}

// error_log joined to its problem, dates as text
const ENTRY_SELECT = `
  e.id, e.course_id, e.problem_id, e.logged_on::text as logged_on, e.week_number, e.unit_number, e.lecture,
  p.label as problem_label, e.student_approach, e.what_went_wrong, e.correct_approach, e.error_types,
  e.primary_error_type, e.lesson, e.redrill_on::text as redrill_on, e.cleared, e.cleared_on::text as cleared_on,
  e.method_line_id`;

// the same columns for `insert ... returning` (no join, so no problem label)
const ENTRY_RETURNING = `
  id, course_id, problem_id, logged_on::text as logged_on, week_number, unit_number, lecture, student_approach,
  what_went_wrong, correct_approach, error_types, primary_error_type, lesson, redrill_on::text as redrill_on,
  cleared, cleared_on::text as cleared_on, method_line_id`;

// ---------------------------------------------------------------------------
// Shared lookups
// ---------------------------------------------------------------------------

interface CourseRow {
  id: string;
  title: string;
  current_unit_override: number | null;
}

/** The student's latest course. */
async function getCourse(): Promise<CourseRow> {
  const rows = await query<CourseRow>(
    `select * from courses where student_id = $1 order by created_at desc limit 1`,
    [STUDENT_ID],
  );
  if (!rows?.[0]) throw new Error("No course yet");
  return rows[0];
}

/** The unit the student is on today: the manual override, else the latest unit that has started. */
async function getCurrentUnit(course: CourseRow, today: ISODate): Promise<number> {
  const rows = await query<{ number: number; start_date: unknown }>(
    `select number, start_date::text as start_date from units where course_id = $1 order by number`,
    [course.id],
  );
  const units = (rows ?? []).map((r) => ({ number: r.number, startDate: isoDate(r.start_date) }));
  return currentUnit(units, today, course.current_unit_override ?? null);
}

/** Week number = the latest week whose start date is on or before the given date. */
async function getWeekNumber(course: CourseRow, date: ISODate): Promise<number | null> {
  const rows = await query<{ week_number: number; start_date: unknown }>(
    `select week_number, start_date::text as start_date from weeks where course_id = $1 order by start_date`,
    [course.id],
  );
  let best: { weekNumber: number; startDate: ISODate } | null = null;
  for (const r of rows ?? []) {
    const startDate = isoDate(r.start_date);
    if (startDate == null || startDate > date) continue;
    if (best == null || startDate >= best.startDate) best = { weekNumber: r.week_number, startDate };
  }
  return best ? best.weekNumber : null;
}

/** Optional text from a form: blank means none. */
function optionalText(value: string | null | undefined): string | null {
  const text = value?.trim();
  return text ? text : null;
}

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

async function insertProblem(q: Query, courseId: string, input: NewProblemInput): Promise<string> {
  const rows = await q<{ id: string }>(
    `insert into problems (course_id, unit_number, lecture, label, statement, answer, origin)
     values ($1, $2, $3, $4, $5, $6, 'user')
     returning id`,
    [
      courseId,
      input.unitNumber,
      optionalText(input.lecture),
      input.label,
      input.statement,
      optionalText(input.answer),
    ],
  );
  if (!rows?.[0]) throw new Error("Could not save the problem");
  return rows[0].id;
}

// ---------------------------------------------------------------------------
// ErrorsService
// ---------------------------------------------------------------------------

export async function logError(
  input: NewProblemInput & { studentApproach: string },
): Promise<{ entry: ErrorLogEntry; pendingLine: MethodLine | null }> {
  const course = await getCourse();
  const today = todayISO();
  const lecture = optionalText(input.lecture);
  const answer = optionalText(input.answer);
  const unitNow = await getCurrentUnit(course, today);
  const weekNumber = await getWeekNumber(course, today);

  // Lines the student already has, so the coach does not draft a near-copy.
  const lineRows = await query<{ trigger: string; move: string }>(
    `select trigger, move from method_lines
     where course_id = $1 and status <> 'rejected'
     order by unit_number, created_at
     limit 150`,
    [course.id],
  );
  const existingLines = (lineRows ?? []).map((r) => ({ trigger: r.trigger, move: r.move }));

  // Diagnose before writing anything, so a model failure leaves no half-saved problem behind.
  const diagnosis = await diagnoseError({
    problem: {
      label: input.label,
      statement: input.statement,
      unitNumber: input.unitNumber,
      lecture,
      answer,
    },
    studentApproach: input.studentApproach,
    courseTitle: course.title,
    existingLines,
  });

  const redrillOn = redrillDate(today, unitNow, input.unitNumber);

  // Every write below lands together or not at all: no orphan problem, and no logged entry without its line.
  return withTransaction(async (q) => {
    const problemId = await insertProblem(q, course.id, input);

    const entryRows = await q<EntryRow>(
      `insert into error_log (
         course_id, problem_id, logged_on, week_number, unit_number, lecture, student_approach,
         what_went_wrong, correct_approach, error_types, primary_error_type, lesson, redrill_on
       )
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       returning ${ENTRY_RETURNING}`,
      [
        course.id,
        problemId,
        today,
        weekNumber,
        input.unitNumber,
        lecture,
        input.studentApproach,
        diagnosis.whatWentWrong,
        diagnosis.correctApproach,
        diagnosis.errorTypes,
        diagnosis.primaryErrorType,
        diagnosis.lesson,
        redrillOn,
      ],
    );
    if (!entryRows?.[0]) throw new Error("Could not save the error log entry");
    // The returned row wins; what we just wrote fills any column it does not carry (the label lives on problems).
    const entry = toEntry(entryRows[0], {
      courseId: course.id,
      problemId,
      loggedOn: today,
      weekNumber,
      unitNumber: input.unitNumber,
      lecture,
      problemLabel: input.label,
      studentApproach: input.studentApproach,
      whatWentWrong: diagnosis.whatWentWrong,
      correctApproach: diagnosis.correctApproach,
      errorTypes: diagnosis.errorTypes,
      primaryErrorType: diagnosis.primaryErrorType,
      lesson: diagnosis.lesson,
      redrillOn,
    });

    let pendingLine: MethodLine | null = null;
    if (diagnosis.methodLine) {
      const lineRowsOut = await q<MethodLineRow>(
        `insert into method_lines (
           course_id, unit_number, lecture, trigger, move, trap, source, origin, status, error_log_id
         )
         values ($1, $2, $3, $4, $5, $6, $7, 'error', 'pending', $8)
         returning *`,
        [
          course.id,
          input.unitNumber,
          lecture,
          diagnosis.methodLine.trigger,
          diagnosis.methodLine.move,
          diagnosis.methodLine.trap,
          `Error log ${today}`,
          entry.id,
        ],
      );
      if (!lineRowsOut?.[0]) throw new Error("Could not save the method line");
      pendingLine = toMethodLine(lineRowsOut[0], {
        courseId: course.id,
        unitNumber: input.unitNumber,
        lecture,
        ...diagnosis.methodLine,
        source: `Error log ${today}`,
        origin: "error",
        status: "pending",
        errorLogId: entry.id,
      });
      await q(`update error_log set method_line_id = $1 where id = $2`, [pendingLine.id, entry.id]);
      entry.methodLineId = pendingLine.id;
    }

    return { entry, pendingLine };
  });
}

/** Every entry for the current course, newest first. */
export async function listErrors(): Promise<ErrorLogEntry[]> {
  const course = await getCourse();
  const rows = await query<EntryRow>(
    `select ${ENTRY_SELECT}
     from error_log e
     join problems p on p.id = e.problem_id
     where e.course_id = $1
     order by e.logged_on desc, e.created_at desc`,
    [course.id],
  );
  // The query already orders newest first; this keeps that order for equal dates and guarantees it otherwise.
  return (rows ?? [])
    .map((r) => toEntry(r))
    .sort((a, b) => (a.loggedOn < b.loggedOn ? 1 : a.loggedOn > b.loggedOn ? -1 : 0));
}

/** Entries whose re-drill date has arrived and that are not cleared yet, with the problem statement. */
export async function dueRedrills(
  today: ISODate = todayISO(),
): Promise<(ErrorLogEntry & { statement: string })[]> {
  const course = await getCourse();
  const rows = await query<EntryRow & { statement: string }>(
    `select ${ENTRY_SELECT}, p.statement as statement
     from error_log e
     join problems p on p.id = e.problem_id
     where e.course_id = $1 and e.cleared = false and e.redrill_on <= $2
     order by e.redrill_on, e.created_at`,
    [course.id, today],
  );
  return (rows ?? []).map((r) => ({ ...toEntry(r), statement: r.statement }));
}

/** Grade a re-drill answer, record the attempt, then clear the entry (pass) or reschedule it (fail). */
export async function answerRedrill(errorLogId: string, answer: string): Promise<Grade> {
  const course = await getCourse();
  const rows = await query<{
    id: string;
    problem_id: string;
    unit_number: number;
    correct_approach: string;
    cleared: boolean;
    statement: string;
    answer: string | null;
  }>(
    `select e.*, p.statement as statement, p.answer as answer
     from error_log e
     join problems p on p.id = e.problem_id
     where e.id = $1 and e.course_id = $2`,
    [errorLogId, course.id],
  );
  const row = rows?.[0];
  if (!row) throw new Error("Error log entry not found");

  const grade = await gradeRedrill({
    problem: { statement: row.statement, answer: row.answer ?? null },
    correctApproach: row.correct_approach,
    studentAnswer: answer,
  });

  // Plain reads stay outside the transaction. Only an entry that is still open needs a new date.
  const today = todayISO();
  const open = row.cleared !== true;
  const nextRedrill =
    open && !grade.passed ? redrillDate(today, await getCurrentUnit(course, today), row.unit_number) : null;

  await withTransaction(async (q) => {
    await q(
      `insert into attempts (course_id, kind, error_log_id, problem_id, question, student_answer, passed, feedback)
       values ($1, 'redrill', $2, $3, $4, $5, $6, $7)`,
      [course.id, row.id, row.problem_id, row.statement, answer, grade.passed, grade.feedback],
    );

    // An entry that is already cleared keeps its state; the attempt above is still recorded.
    if (!open) return;

    // `cleared = false` makes each update a no-op when a concurrent answer already cleared this entry
    // while the model was grading: a late miss cannot reschedule it, a late pass cannot clear it twice.
    if (grade.passed) {
      const cleared = await q<{ id: string }>(
        `update error_log set cleared = true, cleared_on = $2 where id = $1 and cleared = false returning id`,
        [row.id, today],
      );
      if (cleared.length > 0) {
        await q(
          `insert into shuffle_pile (course_id, problem_id, reason, entered_on)
           values ($1, $2, 'cleared', $3)
           on conflict (problem_id) do nothing`,
          [course.id, row.problem_id, today],
        );
      }
    } else {
      await q(`update error_log set redrill_on = $2 where id = $1 and cleared = false`, [row.id, nextRedrill]);
    }
  });

  return grade;
}

/** A problem the student got right goes straight to the shuffle pile. */
export async function logCorrectProblem(input: NewProblemInput): Promise<{ problemId: string }> {
  const course = await getCourse();
  const today = todayISO();
  // Both inserts or neither: a failed pile insert must not leave a problem behind for a retry to duplicate.
  return withTransaction(async (q) => {
    const problemId = await insertProblem(q, course.id, input);
    await q(
      `insert into shuffle_pile (course_id, problem_id, reason, entered_on)
       values ($1, $2, 'got_right', $3)
       on conflict (problem_id) do nothing`,
      [course.id, problemId, today],
    );
    return { problemId };
  });
}

/** Compile-time check that the functions above match the contract. */
export const errorsService: ErrorsService = {
  logError,
  listErrors,
  dueRedrills,
  answerRedrill,
  logCorrectProblem,
};

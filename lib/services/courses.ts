import { seedMethodLines } from "@/lib/agents/methodSheet";
import { planCourse } from "@/lib/agents/planner";
import { STUDENT_ID } from "@/lib/contracts";
import type { Course, CoursePlan, CoursesService, CourseView, ISODate, Unit, Week } from "@/lib/contracts";
import { db, query } from "@/lib/db";
import { embed } from "@/lib/llm";
import { currentUnit, todayISO } from "@/lib/rules";

/** Courses service: plan a course, save it, read the current one, set the current-unit override. */

const MAX_SYLLABUS_FOR_LINES = 12_000;

/** An error whose message is written for the student; routes may show it as is. `status` is the HTTP status it maps to. */
function userError(message: string, status?: number): Error {
  return Object.assign(new Error(message), { userFacing: true, ...(status ? { status } : {}) });
}

// ---------------------------------------------------------------------------
// Row -> contract mapping (snake_case rows, pg returns numerics as strings)
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const two = (n: number) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" from a pg date (a Date at local midnight, or text), or null. */
function isoDate(value: unknown): ISODate | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    const localMidnight =
      value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0 && value.getMilliseconds() === 0;
    return localMidnight
      ? `${value.getFullYear()}-${two(value.getMonth() + 1)}-${two(value.getDate())}`
      : value.toISOString().slice(0, 10);
  }
  const m = String(value).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

const str = (value: unknown): string | null => (value == null ? null : String(value));

function toCourse(row: Row): Course {
  return {
    id: String(row.id),
    title: String(row.title),
    sourceUrl: str(row.source_url),
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    currentUnitOverride: num(row.current_unit_override),
  };
}

function toUnit(row: Row): Unit {
  return {
    number: Number(row.number),
    title: String(row.title),
    startDate: isoDate(row.start_date),
    endDate: isoDate(row.end_date),
    lectures: str(row.lectures),
    topics: str(row.topics),
    estHours: num(row.est_hours),
    difficulty: num(row.difficulty),
    difficultyReason: str(row.difficulty_reason),
  };
}

function toWeek(row: Row): Week {
  return {
    weekNumber: Number(row.week_number),
    startDate: isoDate(row.start_date) ?? "",
    unitNumber: num(row.unit_number),
    lectures: str(row.lectures),
    topics: str(row.topics),
    deadlines: str(row.deadlines),
    studyHours: num(row.study_hours),
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/** What the method-sheet agent reads: the pasted syllabus (if any) plus a lecture-by-lecture outline of the plan. */
function materialsFor(syllabusText: string | undefined, plan: CoursePlan): string {
  const outline = plan.weeks
    .map((w) => {
      const what = [w.lectures, w.topics].filter(Boolean).join(": ");
      const due = w.deadlines ? ` | due: ${w.deadlines}` : "";
      return `Week ${w.weekNumber} (unit ${w.unitNumber ?? "none"}): ${what || "no details"}${due}`;
    })
    .join("\n");
  return syllabusText
    ? `${syllabusText.slice(0, MAX_SYLLABUS_FOR_LINES)}\n\nWEEKLY OUTLINE\n${outline}`
    : `WEEKLY OUTLINE\n${outline}`;
}

/**
 * Plan the course, write the method lines and embed them (all model work first, so a model failure saves
 * nothing), then save the course, units, weeks and seeded method lines in one transaction.
 */
export async function createCourse(input: {
  title?: string;
  syllabusText?: string;
  courseUrl?: string;
}): Promise<{ courseId: string }> {
  const title = input.title?.trim() || undefined;
  const syllabusText = input.syllabusText?.trim() || undefined;
  const courseUrl = input.courseUrl?.trim() || undefined;
  if (!syllabusText && !courseUrl) throw userError("Give a course website or name, or paste a syllabus.");

  const plan = await planCourse({ title, syllabusText, courseUrl, today: todayISO() });
  const drafts = await seedMethodLines({
    courseTitle: plan.course.title,
    units: plan.units,
    materials: materialsFor(syllabusText, plan),
  });
  const vectors = drafts.length > 0 ? await embed(drafts.map((d) => `${d.trigger}. ${d.move}`)) : [];

  const client = await db().connect();
  let discard = false;
  try {
    await client.query("begin");
    // source_url is the primary page Exa read (null when the plan came from pasted text alone).
    const created = await client.query<{ id: string }>(
      `insert into courses (student_id, title, source_url, syllabus_text, start_date, end_date)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [STUDENT_ID, plan.course.title, plan.course.sourceUrl ?? null, syllabusText ?? null, plan.course.startDate, plan.course.endDate],
    );
    const courseId = created.rows[0]?.id;
    if (!courseId) throw new Error("The course could not be saved.");

    for (const u of plan.units) {
      await client.query(
        `insert into units (course_id, number, title, start_date, end_date, lectures, topics, est_hours, difficulty, difficulty_reason)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [courseId, u.number, u.title, u.startDate, u.endDate, u.lectures, u.topics, u.estHours, u.difficulty, u.difficultyReason],
      );
    }
    for (const w of plan.weeks) {
      await client.query(
        `insert into weeks (course_id, week_number, start_date, unit_number, lectures, topics, deadlines, study_hours)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [courseId, w.weekNumber, w.startDate, w.unitNumber, w.lectures, w.topics, w.deadlines, w.studyHours],
      );
    }
    for (const [i, d] of drafts.entries()) {
      const vector = vectors[i];
      await client.query(
        `insert into method_lines (course_id, unit_number, lecture, trigger, move, trap, source, origin, status, embedding)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::vector)`,
        [
          courseId,
          d.unitNumber,
          d.lecture,
          d.trigger,
          d.move,
          d.trap,
          d.source,
          "seed",
          "active",
          vector ? JSON.stringify(vector) : null,
        ],
      );
    }

    await client.query("commit");
    return { courseId };
  } catch (err) {
    try {
      await client.query("rollback");
    } catch {
      // The connection is gone, so the server already dropped the transaction; do not hand it back to the pool.
      discard = true;
    }
    throw err;
  } finally {
    client.release(discard);
  }
}

/** The student's latest course with its units, weeks and the current unit; null when there is none yet. */
export async function getCurrentCourse(): Promise<CourseView | null> {
  const courses = await query<Row>(
    "select * from courses where student_id = $1 order by created_at desc limit 1",
    [STUDENT_ID],
  );
  const row = courses?.[0];
  if (!row) return null;

  const [unitRows, weekRows] = await Promise.all([
    query<Row>("select * from units where course_id = $1 order by number", [row.id]),
    query<Row>("select * from weeks where course_id = $1 order by week_number", [row.id]),
  ]);

  const course = toCourse(row);
  const units = (unitRows ?? []).map(toUnit);
  const weeks = (weekRows ?? []).map(toWeek);
  return { course, units, weeks, currentUnit: currentUnit(units, todayISO(), course.currentUnitOverride) };
}

/**
 * Set (or, with null, clear) the manual current-unit override on the latest course. A unit that is not in the
 * course is rejected with an error carrying status 400, so the route can answer 400.
 */
export async function setCurrentUnitOverride(unit: number | null): Promise<void> {
  const rows = await query<{ id: string }>(
    `update courses set current_unit_override = $1
     where id = (select id from courses where student_id = $2 order by created_at desc limit 1)
       and ($1::int is null or exists (select 1 from units where course_id = courses.id and number = $1))
     returning id`,
    [unit, STUDENT_ID],
  );
  if (unit != null && !rows?.length) throw userError("That unit is not in your current course.", 400);
}

export const coursesService: CoursesService = { createCourse, getCurrentCourse, setCurrentUnitOverride };

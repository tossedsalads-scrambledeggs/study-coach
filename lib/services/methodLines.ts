import { STUDENT_ID } from "@/lib/contracts";
import type { MethodLine } from "@/lib/contracts";
import { query } from "@/lib/db";
import { embed } from "@/lib/llm";

/** pgvector cosine distance below which a new line is a duplicate; measured: paraphrases ~0.16, unrelated lines 0.5+. */
const DUPLICATE_DISTANCE = 0.22;

/** Every column of MethodLine; `embedding` stays in the database (about 10 KB of text per line). */
export const METHOD_LINE_COLUMNS =
  "id, course_id, unit_number, lecture, trigger, move, trap, source, origin, status, error_log_id, passed_at";

export interface CourseRow {
  id: string;
  current_unit_override: number | null;
}

export interface MethodLineRow {
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
  passed_at: Date | string | null;
}

function toISOString(value: Date | string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

export function toMethodLine(row: MethodLineRow): MethodLine {
  return {
    id: row.id,
    courseId: row.course_id,
    unitNumber: row.unit_number,
    lecture: row.lecture,
    trigger: row.trigger,
    move: row.move,
    trap: row.trap,
    source: row.source,
    origin: row.origin,
    status: row.status,
    errorLogId: row.error_log_id,
    passedAt: row.passed_at == null ? null : toISOString(row.passed_at),
  };
}

/** The student's latest course: every service acts on it. */
export async function currentCourse(): Promise<CourseRow | null> {
  const rows = await query<CourseRow>(
    "select * from courses where student_id = $1 order by created_at desc limit 1",
    [STUDENT_ID],
  );
  return rows[0] ?? null;
}

/** Every line on the method sheet except rejected ones, ordered by unit. */
export async function listMethodLines(): Promise<MethodLine[]> {
  const course = await currentCourse();
  if (!course) return [];
  const rows = await query<MethodLineRow>(
    `select ${METHOD_LINE_COLUMNS} from method_lines where course_id = $1 and status <> 'rejected' order by unit_number, created_at`,
    [course.id],
  );
  return rows.map(toMethodLine);
}

/**
 * pending -> active, storing the line's embedding. Throws "Method line not found" for an unknown id,
 * "Method line is not pending" for a line that was already decided, and "Duplicate of: <trigger>" when
 * an active line in the same course is a near-duplicate (cosine distance < DUPLICATE_DISTANCE).
 */
export async function approveLine(id: string): Promise<MethodLine> {
  const found = await query<MethodLineRow>(`select ${METHOD_LINE_COLUMNS} from method_lines where id = $1`, [id]);
  const row = found[0];
  if (!row) throw new Error("Method line not found");
  if (row.status !== "pending") throw new Error("Method line is not pending");

  const [vector] = await embed([`${row.trigger}. ${row.move}`]);
  if (!vector || vector.length === 0) throw new Error("Could not embed the method line");
  const literal = JSON.stringify(vector);

  const nearest = await query<{ trigger: string; distance: number | string | null }>(
    `select trigger, embedding <=> $1::vector as distance
       from method_lines
      where course_id = $2 and status = 'active' and id <> $3 and embedding is not null
      order by embedding <=> $1::vector
      limit 1`,
    [literal, row.course_id, id],
  );
  const closest = nearest[0];
  if (closest && closest.distance != null && Number(closest.distance) < DUPLICATE_DISTANCE) {
    throw new Error(`Duplicate of: ${closest.trigger}`);
  }

  // `status = 'pending'` makes the write a no-op if the line was decided while we were embedding.
  const updated = await query<MethodLineRow>(
    `update method_lines set status = 'active', embedding = $1::vector
      where id = $2 and status = 'pending'
      returning ${METHOD_LINE_COLUMNS}`,
    [literal, id],
  );
  if (!updated[0]) throw new Error("Method line is not pending");
  return toMethodLine(updated[0]);
}

/** pending -> rejected. Throws "Method line not found" or "Method line is not pending" when nothing changed. */
export async function rejectLine(id: string): Promise<void> {
  const rejected = await query<{ id: string }>(
    "update method_lines set status = 'rejected' where id = $1 and status = 'pending' returning id",
    [id],
  );
  if (rejected.length > 0) return;

  const existing = await query<{ id: string }>("select id from method_lines where id = $1", [id]);
  throw new Error(existing.length > 0 ? "Method line is not pending" : "Method line not found");
}

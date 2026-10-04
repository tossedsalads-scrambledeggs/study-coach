import { z } from "zod";
import type { CoursePlan, ISODate, PlanCourse, Unit, Week } from "@/lib/contracts";
import { fetchCourseText } from "@/lib/exa";
import { llmJSON, MODELS } from "@/lib/llm";
import { addDays } from "@/lib/rules";

/**
 * Planner agent: syllabus text and/or a course website -> a CoursePlan (units, weeks, hours, difficulty).
 * One model call; the model's JSON is lenient and every invariant is enforced in code afterwards.
 * Never touches the database.
 */

const MAX_MATERIAL_CHARS = 100_000;
const DEFAULT_WEEKLY_HOURS = 6;
const DEFAULT_DIFFICULTY = 3;
const DEFAULT_DIFFICULTY_REASON = "Difficulty estimated from the topics and workload.";

// ---------------------------------------------------------------------------
// What we ask the model for (mirrors CoursePlan, but forgiving about types)
// ---------------------------------------------------------------------------

const looseNumber = z.union([z.number(), z.string()]).nullish();
const looseText = z.union([z.string(), z.array(z.string())]).nullish();

const unitSchema = z.object({
  number: looseNumber,
  title: z.string().nullish(),
  startDate: z.string().nullish(),
  endDate: z.string().nullish(),
  lectures: looseText,
  topics: looseText,
  estHours: looseNumber,
  difficulty: looseNumber,
  difficultyReason: z.string().nullish(),
});

const weekSchema = z.object({
  weekNumber: looseNumber,
  startDate: z.string().nullish(),
  unitNumber: looseNumber,
  lectures: looseText,
  topics: looseText,
  deadlines: looseText,
  studyHours: looseNumber,
});

const planSchema = z.object({
  course: z.object({
    title: z.string().nullish(),
    sourceUrl: z.string().nullish(),
    startDate: z.string().nullish(),
    endDate: z.string().nullish(),
  }),
  units: z.array(unitSchema).min(1),
  weeks: z.array(weekSchema).min(1),
});

type RawPlan = z.infer<typeof planSchema>;

const SYSTEM = `You are the planner inside a study coach app. You read a course syllabus and/or the text of a course website and lay the whole course out week by week, from the first class to the last, so a student knows what to study and when.

Return one JSON object with exactly this shape:
{
  "course": {"title": string},
  "units": [{"number": 1, "title": string, "lectures": "Lec 1-4" or null, "topics": string or null, "difficulty": integer 1-5, "difficultyReason": string}],
  "weeks": [{"startDate": "YYYY-MM-DD", "unitNumber": integer or null, "lectures": string or null, "topics": string or null, "deadlines": string or null, "studyHours": number}]
}

Rules:
- Units are the course's major blocks of material, in teaching order, numbered 1, 2, 3 and so on. Use the course's own unit, module or chapter grouping when it has one; otherwise group related weeks into 3 to 8 units. Every unit has a short title.
- weeks lists every week in order, from the first week of class through the last, one entry per week with no gaps. Include exam and review weeks. A holiday or break week keeps its place: unitNumber null, topics "Break", studyHours 0. A week's startDate is the first day of that week (a Monday unless the material says otherwise).
- Every week names its unit (unitNumber), the lectures held that week (for example "Lec 5-6"), the topics covered, and the deadlines due that week: problem sets, quizzes, projects and exams (say "Midterm" or "Final" explicitly). Use null for a field the material does not give. Do not invent lecture numbers or deadlines the material does not support, but keep the plan complete.
- studyHours is the number of hours you recommend the student study that week (reading, problem sets, review), typically 4 to 12, more in a week with a problem set or an exam due.
- difficulty is 1 (easy) to 5 (hard) for a typical student. difficultyReason is ONE short sentence saying why (for example "Heavy algebra and the first proofs."). Judge it from how abstract the topics are, how much they build on earlier units, and the workload.
- Dates are ISO calendar dates (YYYY-MM-DD). If the material gives dates without a year, choose the year that puts the course closest to today. If it gives no dates at all, start week 1 on the first Monday on or after today.
- Course title: use the title the student gave if there is one, otherwise the course's own title.
- Be concise: topics and deadlines under 12 words each. Answer directly, without long deliberation.
- Use only the material you are given. If it is thin, still produce the most complete plan it supports. Course website text can include extra pages from the same site, each marked "=== url ==="; use the ones that belong to this course and ignore pages about other courses.`;

// ---------------------------------------------------------------------------
// Normalising helpers (plain code, so they also run on whatever llmJSON hands back)
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

function validYMD(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Any reasonable date value -> "YYYY-MM-DD", or null when it is not a real date. */
function toISODate(value: unknown): ISODate | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (iso) {
    const [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
    return validYMD(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
  }
  // "September 3, 2026" and friends; only when a year is present, so "Sep 3" never gets a guessed year.
  if (/\b(19|20)\d{2}\b/.test(s)) {
    const t = Date.parse(s);
    if (!Number.isNaN(t)) {
      const date = new Date(t);
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const m = value.match(/-?\d+(?:\.\d+)?/);
    const n = m ? Number(m[0]) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** Positive hours rounded to one decimal, or null. */
function positiveHours(value: unknown): number | null {
  const n = toNumber(value);
  if (n == null || n <= 0) return null;
  const r = round1(Math.min(n, 999));
  return r > 0 ? r : null;
}

/** Zero or more hours rounded to one decimal, or null. */
function nonNegativeHours(value: unknown): number | null {
  const n = toNumber(value);
  if (n == null || n < 0) return null;
  return round1(Math.min(n, 999));
}

function clampDifficulty(value: unknown): number {
  const n = toNumber(value);
  if (n == null) return DEFAULT_DIFFICULTY;
  return Math.min(5, Math.max(1, Math.round(n)));
}

/** One line of plain text, or null when empty. Arrays are joined. */
function text(value: unknown): string | null {
  const raw = Array.isArray(value) ? value.filter((v) => typeof v === "string").join("; ") : value;
  if (typeof raw !== "string") return null;
  const s = raw.replace(/\s+/g, " ").trim();
  return s ? s : null;
}

function normalizePlan(
  raw: RawPlan,
  input: { title?: string; courseUrl?: string; today: ISODate },
): CoursePlan {
  const rawUnits = Array.isArray(raw?.units) ? raw.units : [];
  if (rawUnits.length === 0) {
    throw new Error("The course material did not contain anything to plan. Try pasting the syllabus text.");
  }
  const rawWeeks = Array.isArray(raw?.weeks) ? raw.weeks : [];

  // Units: numbered 1..n in the order given. Weeks refer to units by the model's old number, so remap.
  const renumber = new Map<number, number>();
  rawUnits.forEach((u, i) => {
    const old = toNumber(u?.number);
    if (old != null && !renumber.has(old)) renumber.set(old, i + 1);
  });

  // Weeks: numbered 1..n in order, ISO start dates (a missing one follows the week before it).
  const weeks: Week[] = [];
  rawWeeks.forEach((w, i) => {
    const previous = weeks[i - 1]?.startDate;
    const startDate =
      toISODate(w?.startDate) ??
      (previous ? addDays(previous, 7) : (toISODate(raw?.course?.startDate) ?? input.today));
    const oldUnit = toNumber(w?.unitNumber);
    weeks.push({
      weekNumber: i + 1,
      startDate,
      unitNumber: oldUnit != null ? (renumber.get(oldUnit) ?? null) : null,
      lectures: text(w?.lectures),
      topics: text(w?.topics),
      deadlines: text(w?.deadlines),
      studyHours: nonNegativeHours(w?.studyHours),
    });
  });

  const units: Unit[] = rawUnits.map((u, i) => {
    const number = i + 1;
    const own = weeks.filter((w) => w.unitNumber === number);
    const starts = own.map((w) => w.startDate).sort();
    const weekHours = own.reduce((sum, w) => sum + (w.studyHours ?? 0), 0);
    const estHours =
      positiveHours(u?.estHours) ??
      positiveHours(weekHours) ??
      round1(Math.max(1, own.length) * DEFAULT_WEEKLY_HOURS);
    return {
      number,
      title: text(u?.title) ?? `Unit ${number}`,
      startDate: toISODate(u?.startDate) ?? starts[0] ?? null,
      endDate: toISODate(u?.endDate) ?? (starts.length > 0 ? addDays(starts[starts.length - 1], 6) : null),
      lectures: text(u?.lectures),
      topics: text(u?.topics),
      estHours,
      difficulty: clampDifficulty(u?.difficulty),
      difficultyReason: text(u?.difficultyReason) ?? DEFAULT_DIFFICULTY_REASON,
    };
  });

  const firstWeek = weeks[0]?.startDate ?? null;
  const lastWeek = weeks[weeks.length - 1]?.startDate ?? null;
  return {
    course: {
      title: input.title?.trim() || text(raw?.course?.title) || "My course",
      sourceUrl: input.courseUrl?.trim() || null,
      startDate: toISODate(raw?.course?.startDate) ?? firstWeek,
      endDate: toISODate(raw?.course?.endDate) ?? (lastWeek ? addDays(lastWeek, 6) : null),
    },
    units,
    weeks,
  };
}

/**
 * One model call with the smart model. The AI Gateway answers 504 when a model takes over a minute, so on
 * that error (and only that one) ask once more with the fast model, which finishes in a fraction of the time.
 */
async function askModel(args: { system: string; user: string; schema: z.ZodType<RawPlan> }): Promise<RawPlan> {
  try {
    return await llmJSON({ ...args, model: MODELS.smart });
  } catch (err) {
    if (!/AI Gateway 504|took too long/i.test(err instanceof Error ? err.message : String(err))) throw err;
    return await llmJSON({ ...args, model: MODELS.fast });
  }
}

function weekday(date: ISODate): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(d);
}

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

export const planCourse: PlanCourse = async (input) => {
  const syllabusText = input.syllabusText?.trim() ?? "";
  const courseUrl = input.courseUrl?.trim() ?? "";
  if (!syllabusText && !courseUrl) {
    throw new Error("Give the planner a syllabus or a course URL.");
  }

  let siteText = "";
  if (courseUrl) {
    try {
      siteText = ((await fetchCourseText(courseUrl)) ?? "").trim();
    } catch (err) {
      // A pasted syllabus is enough to plan from; with only a URL the failure is the answer.
      if (!syllabusText) throw err;
    }
  }

  const sections: string[] = [];
  if (syllabusText) sections.push(`SYLLABUS (pasted by the student):\n${syllabusText}`);
  if (siteText) sections.push(`COURSE WEBSITE (${courseUrl}):\n${siteText}`);
  const material = sections.join("\n\n").slice(0, MAX_MATERIAL_CHARS);
  if (!material) {
    throw new Error(`Could not read any text from ${courseUrl}. Paste the syllabus text instead.`);
  }

  const day = weekday(input.today);
  const header = [`Today is ${input.today}${day ? ` (${day})` : ""}.`];
  if (input.title?.trim()) header.push(`The student calls this course: "${input.title.trim()}".`);
  const user = [...header, "", "COURSE MATERIAL", "<<<", material, ">>>"].join("\n");

  const raw = await askModel({ system: SYSTEM, user, schema: planSchema });
  return normalizePlan(raw, { title: input.title, courseUrl, today: input.today });
};

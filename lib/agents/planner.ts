import { z } from "zod";
import type { CoursePlan, ISODate, PlanCourse, Unit, Week } from "@/lib/contracts";
import { fetchCourseText } from "@/lib/exa";
import { llmJSON, MODELS } from "@/lib/llm";
import { addDays } from "@/lib/rules";

/**
 * Planner agent: syllabus text and/or a course website or name (read with Exa) -> a CoursePlan (units, weeks,
 * hours, difficulty). One model call; the model's JSON is lenient and every invariant is enforced in code
 * afterwards. Never touches the database.
 */

const MAX_MATERIAL_CHARS = 100_000;
const DEFAULT_WEEKLY_HOURS = 6;
const DEFAULT_DIFFICULTY = 3;
const DEFAULT_DIFFICULTY_REASON = "Difficulty estimated from the topics and workload.";

/** An error whose message is written for the student; routes may show it as is. Any other error becomes a generic message. */
function userError(message: string): Error {
  return Object.assign(new Error(message), { userFacing: true });
}

// ---------------------------------------------------------------------------
// What we ask the model for (mirrors CoursePlan, but forgiving about types)
// ---------------------------------------------------------------------------

const looseNumber = z.union([z.number(), z.string()]).nullish();
const looseText = z.union([z.string(), z.array(z.string())]).nullish();

/** A deadline as the model writes it: a short name and the due date as the material states it. A plain string is accepted too. */
const deadlineItem = z.object({ name: z.string().nullish(), due: z.string().nullish() });
const looseDeadlines = z.union([z.string(), z.array(z.union([z.string(), deadlineItem]))]).nullish();

const unitSchema = z.object({
  number: looseNumber,
  title: z.string().nullish(),
  /** The unit's release / start date copied exactly as the material writes it ("Thur. Sep 10"). */
  released: z.string().nullish(),
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
  deadlines: looseDeadlines,
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

const SYSTEM = `You are the planner inside a study coach app. You read a course syllabus and/or the text of course web pages and lay the whole course out week by week, from the first class to the last, so a student knows what to study and when.

Return one JSON object with exactly this shape:
{
  "course": {"title": string},
  "units": [{"number": 1, "title": string, "released": string or null, "lectures": "Lec 1-4" or null, "topics": string or null, "difficulty": integer 1-5, "difficultyReason": string}],
  "weeks": [{"startDate": "YYYY-MM-DD", "unitNumber": integer or null, "lectures": string or null, "topics": string or null, "deadlines": [{"name": string, "due": string}] or null, "studyHours": number}]
}

Rules:
- Units are the course's major blocks of material, in teaching order. Use the course's own unit, module or chapter grouping when it has one, and give each unit's number exactly as the material writes it ("Unit 4: Discrete random variables" has number 4, even if that is not its position in the list). Only when the material has no grouping, group related weeks into 3 to 8 units numbered 1, 2, 3 and so on. Every unit has a short title.
- Skip overview, orientation and welcome units that have no lectures (for example "Unit 0: Overview"): do not list them as units, and do not count them when you number the others.
- released: when the material gives a date for when a unit is released, opens or starts (for example "Unit 3: Counting (released Thur. Sep 10)"), copy that date exactly as the material writes it ("Thur. Sep 10"). Do not convert, compute or guess it; if it gives a range, copy the first date. Use null only when the material states no date for that unit. Units can share a date. Never space units out evenly when the material gives their dates.
- weeks lists every week in order, from the first week of class through the last, one entry per week with no gaps. Include exam and review weeks. A holiday or break week keeps its place: unitNumber null, topics "Break", studyHours 0. A week's startDate is the first day of that week (a Monday unless the material says otherwise).
- unitNumber is the number of the unit being studied that week, as listed in units. A deadline for an earlier unit does not change it. A week that only covers a skipped overview unit gets the first listed unit.
- Every week names the lectures held that week (for example "Lec 5-6") and the topics covered. Use null for a field the material does not give. Do not invent lecture numbers or deadlines the material does not support, but keep the plan complete.
- deadlines has one entry for each problem set, quiz, project or exam due that week. name is short ("PS 1", "Quiz 2", "Exam 1"). due is the exact due date the material gives, with the weekday, month and day ("Wednesday September 9"); never leave the date out and never give only the weekday. Put each deadline in the week whose dates contain its due date. Use null when nothing is due that week.
- studyHours is the number of hours you recommend the student study that week (reading, problem sets, review), typically 4 to 12, more in a week with a problem set or an exam due.
- difficulty is 1 (easy) to 5 (hard) for a typical student. difficultyReason is ONE short sentence saying why (for example "Heavy algebra and the first proofs."). Judge it from how abstract the topics are, how much they build on earlier units, and the workload.
- startDate is an ISO calendar date (YYYY-MM-DD). If the material gives dates without a year, choose the year that puts the course closest to today. If it gives no dates at all, start week 1 on the first Monday on or after today.
- Write maths as plain text (for example P(A ∩ B), 1/2^n), never LaTeX.
- Course title: use the title the student gave if there is one, otherwise the course's own title.
- Be concise: topics under 12 words. Answer directly, without long deliberation.
- Use only the material you are given. If it is thin, still produce the most complete plan it supports. Course pages can include several pages from the same site, each marked "=== url ==="; use the ones that belong to this course and ignore pages about other courses.`;

// ---------------------------------------------------------------------------
// Normalising helpers (plain code, so they also run on whatever llmJSON hands back)
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");

function validYMD(y: number, m: number, d: number): boolean {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

function ymd(y: number, m: number, d: number): ISODate | null {
  return validYMD(y, m, d) ? `${y}-${pad(m)}-${pad(d)}` : null;
}

/** Any reasonable date value -> "YYYY-MM-DD", or null when it is not a real date. */
function toISODate(value: unknown): ISODate | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const s = value.trim();
  const iso = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/);
  if (iso) return ymd(Number(iso[1]), Number(iso[2]), Number(iso[3]));
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

// ---------------------------------------------------------------------------
// Dates the material states in its own words ("Thur. Sep 10", "Wednesday September 9")
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  jan: 1,
  feb: 2,
  mar: 3,
  apr: 4,
  may: 5,
  jun: 6,
  jul: 7,
  aug: 8,
  sep: 9,
  oct: 10,
  nov: 11,
  dec: 12,
};
const MONTH =
  "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const MONTH_THEN_DAY = new RegExp(`\\b${MONTH}\\.?\\s*(\\d{1,2})(?:st|nd|rd|th)?\\b(?:\\s*,?\\s*(\\d{4}))?`, "i");
const DAY_THEN_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${MONTH}\\b(?:\\s*,?\\s*(\\d{4}))?`, "i");
const WEEKDAY = /\b(sun|mon|tue|wed|thu|fri|sat)[a-z]*\b/i;
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Where the course sits in time: used to pick the year for a date written without one. */
type DateContext = { window: { start: ISODate; end: ISODate } | null; year: number };

const weekdayOf = (iso: ISODate) => new Date(`${iso}T00:00:00Z`).getUTCDay();
const dayGap = (a: ISODate, b: ISODate) => Math.round((Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000);

function distanceToWindow(iso: ISODate, window: { start: ISODate; end: ISODate }): number {
  if (iso < window.start) return dayGap(window.start, iso);
  if (iso > window.end) return dayGap(iso, window.end);
  return 0;
}

/** "Wed Sep 9" */
function shortDate(iso: ISODate): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${DAY_NAMES[d.getUTCDay()]} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

function readMonthDay(s: string): { month: number; day: number; year: number | null } | null {
  const iso = s.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return { year: Number(iso[1]), month: Number(iso[2]), day: Number(iso[3]) };
  const monthFirst = s.match(MONTH_THEN_DAY);
  if (monthFirst) {
    return {
      month: MONTHS[monthFirst[1].slice(0, 3).toLowerCase()],
      day: Number(monthFirst[2]),
      year: monthFirst[3] ? Number(monthFirst[3]) : null,
    };
  }
  const dayFirst = s.match(DAY_THEN_MONTH);
  if (dayFirst) {
    return {
      month: MONTHS[dayFirst[2].slice(0, 3).toLowerCase()],
      day: Number(dayFirst[1]),
      year: dayFirst[3] ? Number(dayFirst[3]) : null,
    };
  }
  const numeric = s.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (numeric) {
    const year = numeric[3] ? (numeric[3].length === 2 ? 2000 + Number(numeric[3]) : Number(numeric[3])) : null;
    return { month: Number(numeric[1]), day: Number(numeric[2]), year };
  }
  return null;
}

/**
 * A date as the material writes it -> "YYYY-MM-DD". Without a year, the year is the one that puts the date
 * inside (or closest to) the course's weeks; a weekday in the text ("Thur. Sep 10") settles it when it can.
 */
function parseStatedDate(value: unknown, ctx: DateContext): ISODate | null {
  if (typeof value !== "string") return null;
  const s = value.trim();
  const found = s ? readMonthDay(s) : null;
  if (!found) return null;

  const weekdayWord = s.match(WEEKDAY)?.[1].toLowerCase();
  const weekday = weekdayWord ? DAY_NAMES.findIndex((d) => d.toLowerCase() === weekdayWord) : -1;

  const base = ctx.window ? Number(ctx.window.start.slice(0, 4)) : ctx.year;
  const last = ctx.window ? Number(ctx.window.end.slice(0, 4)) : ctx.year;
  const years = found.year != null ? [found.year] : [...new Set([base, last, base + 1, base - 1])];

  let options = years.map((y) => ymd(y, found.month, found.day)).filter((d): d is ISODate => d != null);
  if (weekday >= 0) {
    const sameWeekday = options.filter((d) => weekdayOf(d) === weekday);
    if (sameWeekday.length > 0) options = sameWeekday;
  }
  if (options.length === 0) return null;
  const window = ctx.window;
  if (window && options.length > 1) {
    options = [...options].sort((a, b) => distanceToWindow(a, window) - distanceToWindow(b, window));
  }
  return options[0];
}

/** The day inside the week starting on `weekStart` that falls on `weekday` (0 = Sunday). */
function dayInWeek(weekStart: ISODate, weekday: number): ISODate {
  return addDays(weekStart, (weekday - weekdayOf(weekStart) + 7) % 7);
}

/** "PS 1 due Wed Sep 9; Exam 1 due Wed Oct 7". A weekday with no date resolves inside the week it was filed under. */
function formatDeadlines(value: unknown, ctx: DateContext, weekStart: ISODate): string | null {
  if (typeof value === "string") return text(value);
  if (!Array.isArray(value)) return null;
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      const line = text(item);
      if (line) parts.push(line);
      continue;
    }
    const entry = item as { name?: unknown; due?: unknown } | null;
    const name = text(entry?.name);
    const due = text(entry?.due);
    let when = due;
    if (due) {
      const stated = parseStatedDate(due, ctx);
      const weekdayWord = due.match(WEEKDAY)?.[1].toLowerCase();
      const weekday = weekdayWord ? DAY_NAMES.findIndex((d) => d.toLowerCase() === weekdayWord) : -1;
      if (stated) when = shortDate(stated);
      else if (weekday >= 0) when = shortDate(dayInWeek(weekStart, weekday));
    }
    if (name && when) parts.push(`${name} due ${when}`);
    else if (name) parts.push(name);
    else if (when) parts.push(`Due ${when}`);
  }
  return parts.length > 0 ? parts.join("; ") : null;
}

type RawUnit = RawPlan["units"][number];

/** "Overview", "Course overview", "Unit 0: Introduction", "Welcome" and the like: a title with nothing else in it. */
const OVERVIEW_TITLE =
  /^(?:unit\s*\d+\s*[:.\-–—]\s*)?(?:course\s+)?(?:overview|introduction|intro|orientation|welcome|getting started|logistics|information|syllabus)\s*$/i;

/** An overview / orientation unit has no lectures to study: unit 0, or a title that is only "Overview" and the like. */
function isOverviewUnit(u: RawUnit): boolean {
  if (toNumber(u?.number) === 0) return true;
  const title = text(u?.title);
  const lectures = text(u?.lectures);
  return title != null && OVERVIEW_TITLE.test(title) && !(lectures != null && /\d/.test(lectures));
}

function normalizePlan(
  raw: RawPlan,
  input: { title?: string; sourceUrl: string | null; today: ISODate },
): CoursePlan {
  const allUnits = Array.isArray(raw?.units) ? raw.units : [];
  // Overview units (Unit 0, "Overview" with no lectures) are not studied: drop them, unless nothing else is left.
  const studied = allUnits.filter((u) => !isOverviewUnit(u));
  const rawUnits = studied.length > 0 ? studied : allUnits;
  if (rawUnits.length === 0) {
    throw userError("The course material did not contain anything to plan. Try pasting the syllabus text.");
  }
  const rawWeeks = Array.isArray(raw?.weeks) ? raw.weeks : [];

  // Units: numbered 1..n in the order given. Weeks refer to units by the model's old number, so remap.
  const renumber = new Map<number, number>();
  rawUnits.forEach((u, i) => {
    const old = toNumber(u?.number);
    if (old != null && !renumber.has(old)) renumber.set(old, i + 1);
  });
  // A week that only covered a dropped overview unit belongs to the first real unit.
  allUnits.forEach((u) => {
    const old = toNumber(u?.number);
    if (!rawUnits.includes(u) && old != null && !renumber.has(old)) renumber.set(old, 1);
  });
  if (!renumber.has(0)) renumber.set(0, 1);

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
      deadlines: null,
      studyHours: nonNegativeHours(w?.studyHours),
    });
  });

  // Where the course sits in time, to give a year to dates the material writes without one.
  const weekStarts = weeks.map((w) => w.startDate).sort();
  const courseStart = toISODate(raw?.course?.startDate);
  const courseEnd = toISODate(raw?.course?.endDate);
  const window =
    weekStarts.length > 0
      ? { start: weekStarts[0], end: addDays(weekStarts[weekStarts.length - 1], 6) }
      : courseStart && courseEnd
        ? { start: courseStart, end: courseEnd }
        : null;
  const ctx: DateContext = { window, year: Number(input.today.slice(0, 4)) };

  // Deadlines carry the exact date the material gives.
  rawWeeks.forEach((w, i) => {
    weeks[i].deadlines = formatDeadlines(w?.deadlines, ctx, weeks[i].startDate);
  });

  // Unit start dates: the release date the material states wins; only then a date from the model, then the unit's first week.
  const stated = rawUnits.map((u) => parseStatedDate(u?.released, ctx));
  const starts = rawUnits.map((u, i) => {
    const own = weeks.filter((w) => w.unitNumber === i + 1).map((w) => w.startDate).sort();
    return stated[i] ?? toISODate(u?.startDate) ?? own[0] ?? null;
  });

  const units: Unit[] = rawUnits.map((u, i) => {
    const number = i + 1;
    const own = weeks.filter((w) => w.unitNumber === number);
    const ownStarts = own.map((w) => w.startDate).sort();
    const weekHours = own.reduce((sum, w) => sum + (w.studyHours ?? 0), 0);
    const estHours =
      positiveHours(u?.estHours) ??
      positiveHours(weekHours) ??
      round1(Math.max(1, own.length) * DEFAULT_WEEKLY_HOURS);

    const startDate = starts[i];
    let endDate = toISODate(u?.endDate);
    if (!endDate) {
      if (stated[i] != null) {
        // A stated release runs until the next later release (units can share a date), or the end of the course.
        const later = starts.filter((s, j) => j > i && s != null && startDate != null && s > startDate).sort();
        endDate = later.length > 0 ? addDays(later[0] as ISODate, -1) : (window?.end ?? null);
      } else if (ownStarts.length > 0) {
        endDate = addDays(ownStarts[ownStarts.length - 1], 6);
      }
    }
    if (startDate && endDate && endDate < startDate) endDate = startDate;

    return {
      number,
      title: text(u?.title) ?? `Unit ${number}`,
      startDate,
      endDate,
      lectures: text(u?.lectures),
      topics: text(u?.topics),
      estHours,
      difficulty: clampDifficulty(u?.difficulty),
      difficultyReason: text(u?.difficultyReason) ?? DEFAULT_DIFFICULTY_REASON,
    };
  });

  const firstWeek = weekStarts[0] ?? null;
  const lastWeek = weekStarts[weekStarts.length - 1] ?? null;
  return {
    course: {
      title: input.title?.trim() || text(raw?.course?.title) || "My course",
      sourceUrl: input.sourceUrl,
      startDate: courseStart ?? firstWeek,
      endDate: courseEnd ?? (lastWeek ? addDays(lastWeek, 6) : null),
    },
    units,
    weeks,
  };
}

function weekday(date: ISODate): string {
  const d = new Date(`${date}T00:00:00Z`);
  return Number.isNaN(d.getTime())
    ? ""
    : new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(d);
}

/** The page Exa read first (every page in the text starts with "=== url ==="): the course's primary source. */
function firstSourceUrl(siteText: string): string | null {
  return siteText.match(/^=== (\S+) ===$/m)?.[1] ?? null;
}

// ---------------------------------------------------------------------------
// The agent
// ---------------------------------------------------------------------------

export const planCourse: PlanCourse = async (input) => {
  const syllabusText = input.syllabusText?.trim() ?? "";
  const courseUrl = input.courseUrl?.trim() ?? "";
  if (!syllabusText && !courseUrl) {
    throw userError("Give the planner a syllabus, a course website or a course name.");
  }

  // courseUrl is a course website or a course name; Exa reads the page or searches for the syllabus.
  let siteText = "";
  if (courseUrl) {
    try {
      siteText = ((await fetchCourseText(courseUrl)) ?? "").trim();
    } catch (err) {
      // A pasted syllabus is enough to plan from; with only a URL or name the failure is the answer.
      if (!syllabusText) throw err;
    }
  }

  const sections: string[] = [];
  if (syllabusText) sections.push(`SYLLABUS (pasted by the student):\n${syllabusText}`);
  if (siteText) sections.push(`COURSE PAGES (read with Exa for "${courseUrl}"):\n${siteText}`);
  const material = sections.join("\n\n").slice(0, MAX_MATERIAL_CHARS);
  if (!material) {
    throw userError(`Could not read any text from ${courseUrl}. Paste the syllabus text instead.`);
  }

  const day = weekday(input.today);
  const header = [`Today is ${input.today}${day ? ` (${day})` : ""}.`];
  if (input.title?.trim()) header.push(`The student calls this course: "${input.title.trim()}".`);
  const user = [...header, "", "COURSE MATERIAL", "<<<", material, ">>>"].join("\n");

  const raw = await llmJSON({ system: SYSTEM, user, schema: planSchema, model: MODELS.smart });
  return normalizePlan(raw, { title: input.title, sourceUrl: firstSourceUrl(siteText), today: input.today });
};

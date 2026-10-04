import type { ErrorType, ISODate, MethodLine, Unit } from "./contracts";

const TIMEZONE = process.env.APP_TIMEZONE ?? "America/Los_Angeles";

/** Today's date in the student's timezone. */
export function todayISO(now: Date = new Date()): ISODate {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(now);
}

export function addDays(date: ISODate, days: number): ISODate {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Re-drill gap: a problem from the unit you're on comes back in 2 days; one from any earlier unit in 7. */
export function redrillDays(currentUnit: number, problemUnit: number): number {
  return problemUnit < currentUnit ? 7 : 2;
}

export function redrillDate(today: ISODate, currentUnit: number, problemUnit: number): ISODate {
  return addDays(today, redrillDays(currentUnit, problemUnit));
}

/** The manual override wins; otherwise the latest unit that has started; before the course starts, unit 1. */
export function currentUnit(
  units: Pick<Unit, "number" | "startDate">[],
  today: ISODate,
  override: number | null,
): number {
  if (override != null) return override;
  const started = units.filter((u) => u.startDate != null && u.startDate <= today).map((u) => u.number);
  return started.length > 0 ? Math.max(...started) : 1;
}

/** Every error except a pure computational slip adds a method line. */
export function needsMethodLine(types: ErrorType[]): boolean {
  return types.some((t) => t !== "computational_slip");
}

/** Lines the quiz may ask: approved, not yet passed, and from a unit the student has reached. */
export function quizPool(lines: MethodLine[], current: number): MethodLine[] {
  return lines.filter((l) => l.status === "active" && l.passedAt == null && l.unitNumber <= current);
}

/** Random line from the pool, avoiding an immediate repeat when there is another choice. */
export function pickQuizLine(
  lines: MethodLine[],
  current: number,
  lastLineId: string | null,
  random: () => number = Math.random,
): MethodLine | null {
  const pool = quizPool(lines, current);
  if (pool.length === 0) return null;
  const choices = pool.length > 1 ? pool.filter((l) => l.id !== lastLineId) : pool;
  return choices[Math.floor(random() * choices.length)];
}

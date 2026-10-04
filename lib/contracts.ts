/**
 * Shared contracts for every Study Coach agent.
 * Owned by the orchestrator: builders implement these signatures exactly and never edit this file.
 * Dates are ISO calendar dates ("YYYY-MM-DD").
 */

export const STUDENT_ID = "00000000-0000-0000-0000-000000000001";

export const ERROR_TYPES = ["concept_gap", "computational_slip", "wrong_tool", "misread_setup"] as const;
export type ErrorType = (typeof ERROR_TYPES)[number];

export const ERROR_TYPE_LABELS: Record<ErrorType, string> = {
  concept_gap: "Concept gap",
  computational_slip: "Computational slip",
  wrong_tool: "Wrong tool",
  misread_setup: "Misread setup",
};

export type ISODate = string;

export interface Course {
  id: string;
  title: string;
  sourceUrl: string | null;
  startDate: ISODate | null;
  endDate: ISODate | null;
  currentUnitOverride: number | null;
}

export interface Unit {
  number: number;
  title: string;
  startDate: ISODate | null;
  endDate: ISODate | null;
  lectures: string | null; // "Lec 1-3"
  topics: string | null;
  estHours: number | null; // total study hours for the unit
  difficulty: number | null; // 1 (easy) to 5 (hard)
  difficultyReason: string | null;
}

export interface Week {
  weekNumber: number;
  startDate: ISODate;
  unitNumber: number | null;
  lectures: string | null;
  topics: string | null;
  deadlines: string | null; // problem sets and exams due that week
  studyHours: number | null;
}

/** One row of the method sheet. Must be actionable inside a problem, never a true-in-general fact. */
export interface MethodLine {
  id: string;
  courseId: string;
  unitNumber: number;
  lecture: string | null;
  trigger: string; // the situation in a problem that should fire this move
  move: string; // what to do, concretely
  trap: string; // the tempting wrong move
  source: string | null; // "U4 Lec 5, 11" or "Error log 2026-09-09"
  origin: "seed" | "error";
  status: "active" | "pending" | "rejected"; // error-born lines start "pending" until the student approves
  errorLogId: string | null;
  passedAt: string | null; // first quiz pass; the line leaves the quiz after that
}

export interface MethodLineDraft {
  unitNumber: number;
  lecture: string | null;
  trigger: string;
  move: string;
  trap: string;
  source: string | null;
}

export interface Problem {
  id: string;
  courseId: string;
  unitNumber: number;
  lecture: string | null;
  label: string; // "Ex 4 - Sample Space, part 1"
  statement: string;
  answer: string | null;
  origin: "user" | "shuffle";
  parentProblemId: string | null;
}

export interface ErrorLogEntry {
  id: string;
  courseId: string;
  problemId: string;
  loggedOn: ISODate;
  weekNumber: number | null;
  unitNumber: number;
  lecture: string | null;
  problemLabel: string;
  studentApproach: string;
  whatWentWrong: string;
  correctApproach: string;
  errorTypes: ErrorType[];
  primaryErrorType: ErrorType;
  lesson: string;
  redrillOn: ISODate;
  cleared: boolean;
  clearedOn: ISODate | null;
  methodLineId: string | null;
}

export interface ShuffleItem {
  id: string;
  courseId: string;
  problemId: string;
  reason: "cleared" | "got_right";
  status: "waiting" | "fully_cleared";
  enteredOn: ISODate;
  fullyClearedOn: ISODate | null;
}

export interface Grade {
  passed: boolean;
  feedback: string;
}

export interface CoursePlan {
  course: { title: string; sourceUrl: string | null; startDate: ISODate | null; endDate: ISODate | null };
  units: Unit[];
  weeks: Week[];
}

export interface Diagnosis {
  whatWentWrong: string;
  correctApproach: string;
  errorTypes: ErrorType[]; // every type that applies
  primaryErrorType: ErrorType;
  lesson: string; // "the fix": one reusable sentence
  methodLine: { trigger: string; move: string; trap: string } | null; // null only if needsMethodLine(errorTypes) is false
}

export interface QuizQuestion {
  methodLineId: string;
  unitNumber: number;
  question: string;
}

export interface ProblemVariant {
  statement: string;
  answer: string;
  solution: string;
}

// ---------------------------------------------------------------------------
// Agents: pure functions of their inputs. Every model call goes through lib/llm.ts.
// ---------------------------------------------------------------------------

/** lib/agents/planner.ts -> export const planCourse */
export type PlanCourse = (input: {
  title?: string;
  syllabusText?: string;
  courseUrl?: string;
  today: ISODate;
}) => Promise<CoursePlan>;

/** lib/agents/methodSheet.ts -> export const seedMethodLines */
export type SeedMethodLines = (input: {
  courseTitle: string;
  units: Unit[];
  materials?: string;
}) => Promise<MethodLineDraft[]>;

/** lib/agents/methodQuiz.ts -> export const writeQuizQuestion, gradeQuizAnswer */
export type WriteQuizQuestion = (line: MethodLine, recentQuestions: string[]) => Promise<string>;
export type GradeQuizAnswer = (line: MethodLine, question: string, answer: string) => Promise<Grade>;

/** lib/agents/errorCoach.ts -> export const diagnoseError, gradeRedrill */
export type DiagnoseError = (input: {
  problem: Pick<Problem, "label" | "statement" | "unitNumber" | "lecture" | "answer">;
  studentApproach: string;
  courseTitle: string;
  existingLines: Pick<MethodLine, "trigger" | "move">[];
}) => Promise<Diagnosis>;
export type GradeRedrill = (input: {
  problem: Pick<Problem, "statement" | "answer">;
  correctApproach: string;
  studentAnswer: string;
}) => Promise<Grade>;

/** lib/agents/shuffle.ts -> export const makeVariant, gradeVariant */
export type MakeVariant = (input: {
  problem: Pick<Problem, "statement" | "answer" | "unitNumber" | "lecture">;
  lesson: string | null;
  previousVariants: string[];
}) => Promise<ProblemVariant>;
export type GradeVariant = (input: { variant: ProblemVariant; studentAnswer: string }) => Promise<Grade>;

// ---------------------------------------------------------------------------
// Services: DB + agents. REST routes and the coach chat both call these, never the tables directly.
// All services act on the current course (the student's latest course).
// ---------------------------------------------------------------------------

export interface CourseView {
  course: Course;
  units: Unit[];
  weeks: Week[];
  currentUnit: number;
}

export interface NewProblemInput {
  label: string;
  statement: string;
  unitNumber: number;
  lecture?: string | null;
  answer?: string | null;
}

/** lib/services/courses.ts */
export interface CoursesService {
  createCourse(input: { title?: string; syllabusText?: string; courseUrl?: string }): Promise<{ courseId: string }>;
  getCurrentCourse(): Promise<CourseView | null>;
  setCurrentUnitOverride(unit: number | null): Promise<void>;
}

/** lib/services/methodLines.ts */
export interface MethodLinesService {
  listMethodLines(): Promise<MethodLine[]>;
  approveLine(id: string): Promise<MethodLine>;
  rejectLine(id: string): Promise<void>;
}

/** lib/services/quiz.ts */
export interface QuizService {
  nextQuizQuestion(): Promise<QuizQuestion | null>; // null when every line in reach is passed
  answerQuiz(input: { methodLineId: string; question: string; answer: string }): Promise<Grade>;
  quizTracker(): Promise<{ byUnit: { unitNumber: number; total: number; passed: number }[] }>;
}

/** lib/services/errors.ts */
export interface ErrorsService {
  logError(input: NewProblemInput & { studentApproach: string }): Promise<{
    entry: ErrorLogEntry;
    pendingLine: MethodLine | null;
  }>;
  listErrors(): Promise<ErrorLogEntry[]>;
  dueRedrills(today?: ISODate): Promise<(ErrorLogEntry & { statement: string })[]>;
  answerRedrill(errorLogId: string, answer: string): Promise<Grade>;
  logCorrectProblem(input: NewProblemInput): Promise<{ problemId: string }>;
}

/** lib/services/shuffle.ts */
export interface ShuffleService {
  nextShuffleProblem(): Promise<{ itemId: string; problemId: string; statement: string } | null>;
  answerShuffle(input: { itemId: string; problemId: string; answer: string }): Promise<
    Grade & { errorLogId: string | null }
  >;
}

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GradeVariant, MakeVariant, ProblemVariant } from "@/lib/contracts";

// Agents are pure: every model call goes through llmJSON, which is mocked here. No network, no database.
vi.mock("@/lib/llm", () => ({
  llmJSON: vi.fn(),
  chat: vi.fn(),
  embed: vi.fn(),
  MODELS: { smart: "s", fast: "f", embed: "e" },
}));

import { llmJSON } from "@/lib/llm";
import { gradeVariant, makeVariant } from "@/lib/agents/shuffle";

// Compile-time only: the exports must satisfy the contract types.
const make: MakeVariant = makeVariant;
const grade: GradeVariant = gradeVariant;

const llm = vi.mocked(llmJSON);

type MakeInput = Parameters<MakeVariant>[0];
type LlmArgs = Parameters<typeof llmJSON>[0];

/** First argument of the n-th (0-based) llmJSON call. */
function callArgs(n: number): LlmArgs {
  const call = llm.mock.calls[n];
  if (!call) throw new Error(`llmJSON call #${n + 1} never happened (it was called ${llm.mock.calls.length} time(s))`);
  return call[0];
}

/** Everything the model was told in the n-th call. Only used to check that data is passed, never its wording. */
function promptOf(n: number): string {
  const { system, user } = callArgs(n);
  return `${system}\n${user}`;
}

beforeEach(() => {
  llm.mockReset();
});

const ORIGINAL =
  "A bag holds 5 red and 7 blue marbles. Two marbles are drawn without replacement. What is the probability that both are red?";
const PREV_A =
  "A box has 3 white and 6 black socks. Two socks are pulled out one after another without putting any back. What is the probability that both are white?";
const PREV_B =
  "A shelf has 4 maths and 8 history books. Two books are picked without replacement. What is the probability that both are maths books?";
const PREVIOUS = [PREV_A, PREV_B];

const FRESH: ProblemVariant = {
  statement:
    "A jar contains 4 green and 9 yellow beads. Two beads are taken one at a time without replacement. What is the probability that both are green?",
  answer: "1/13",
  solution: "The first bead is green with probability 4/13, then the second with 3/12, so the answer is 4/13 times 3/12 = 1/13.",
};

function input(overrides: Partial<MakeInput> = {}): MakeInput {
  return {
    problem: { statement: ORIGINAL, answer: "5/33", unitNumber: 2, lecture: "Lec 4" },
    lesson: "Without replacement, the denominator shrinks after every draw.",
    previousVariants: [],
    ...overrides,
  };
}

describe("makeVariant", () => {
  it("makes one model call and returns the variant when it is new", async () => {
    llm.mockResolvedValueOnce(FRESH);

    const variant = await make(input());

    expect(variant).toEqual(FRESH);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("trims whitespace from statement, answer and solution", async () => {
    llm.mockResolvedValueOnce({
      statement: `  \n${FRESH.statement}  \n`,
      answer: "  \t1/13 ",
      solution: `\n  ${FRESH.solution}\n\n`,
    });

    const variant = await make(input());

    expect(variant).toEqual(FRESH);
  });

  it("writes the variant with the smart model", async () => {
    llm.mockResolvedValueOnce(FRESH);

    await make(input());

    // llmJSON defaults to MODELS.smart, so passing it explicitly and omitting it are both correct.
    expect([undefined, "s"]).toContain(callArgs(0).model);
  });

  it("asks the model for an object with statement, answer and solution", async () => {
    llm.mockResolvedValueOnce(FRESH);

    await make(input());

    const { schema } = callArgs(0);
    expect(schema.safeParse(FRESH).success).toBe(true);
    for (const key of ["statement", "answer", "solution"] as const) {
      const incomplete: Record<string, unknown> = { ...FRESH };
      delete incomplete[key];
      expect(schema.safeParse(incomplete).success, `the schema should require "${key}"`).toBe(false);
    }
  });

  it("shows the model the original statement and every previous variant", async () => {
    llm.mockResolvedValueOnce(FRESH);

    await make(input({ previousVariants: PREVIOUS }));

    const prompt = promptOf(0);
    expect(prompt).toContain(ORIGINAL);
    for (const previous of PREVIOUS) expect(prompt).toContain(previous);
  });

  it("works when the original has no stored answer or lecture and there is no lesson", async () => {
    llm.mockResolvedValueOnce(FRESH);

    const variant = await make(
      input({ problem: { statement: ORIGINAL, answer: null, unitNumber: 1, lecture: null }, lesson: null }),
    );

    expect(variant).toEqual(FRESH);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("does not ask again when the variant is new, even with previous variants on file", async () => {
    llm.mockResolvedValueOnce(FRESH);

    const variant = await make(input({ previousVariants: PREVIOUS }));

    expect(variant).toEqual(FRESH);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  describe("when the first variant repeats a statement it must avoid", () => {
    const CASES: { name: string; previousVariants: string[]; repeated: string }[] = [
      { name: "the original statement in upper case", previousVariants: [], repeated: ORIGINAL.toUpperCase() },
      {
        name: "the original statement in lower case with surrounding whitespace",
        previousVariants: [],
        repeated: `  \n${ORIGINAL.toLowerCase()}\t  `,
      },
      { name: "a previous variant in upper case", previousVariants: PREVIOUS, repeated: PREV_B.toUpperCase() },
      {
        name: "a previous variant with surrounding whitespace",
        previousVariants: PREVIOUS,
        repeated: `\n ${PREV_A} `,
      },
    ];

    it.each(CASES)("calls the model a second time and returns the new variant: $name", async ({ previousVariants, repeated }) => {
      llm
        .mockResolvedValueOnce({ statement: repeated, answer: "old answer", solution: "old solution" })
        .mockResolvedValueOnce(FRESH);

      const variant = await make(input({ previousVariants }));

      expect(llm).toHaveBeenCalledTimes(2);
      expect(variant).toEqual(FRESH);
    });

    it("returns whatever the second call gives, trimmed, even if it repeats too, and does not call a third time", async () => {
      llm
        .mockResolvedValueOnce({ statement: ORIGINAL.toUpperCase(), answer: "5/33", solution: "first" })
        .mockResolvedValueOnce({
          statement: `  ${ORIGINAL.toLowerCase()}  `,
          answer: " 5/33 again ",
          solution: "\n second \n",
        });

      const variant = await make(input());

      expect(llm).toHaveBeenCalledTimes(2);
      expect(variant).toEqual({ statement: ORIGINAL.toLowerCase(), answer: "5/33 again", solution: "second" });
    });
  });

  it("rejects when the model call fails", async () => {
    llm.mockRejectedValue(new Error("gateway down"));

    await expect(make(input())).rejects.toThrow();
  });
});

describe("gradeVariant", () => {
  const VARIANT: ProblemVariant = {
    statement: FRESH.statement,
    answer: "1/13 (about 7.7%)",
    solution: "Multiply the two draw probabilities.",
  };
  const STUDENT_ANSWER = "4/13 (about 30.8%)";

  it.each([
    { passed: true, feedback: "Correct: you multiplied 4/13 by 3/12." },
    { passed: false, feedback: "Not quite: after the first bead only 12 remain, so the second factor is 3/12." },
  ])("returns the model's grade as is (passed: $passed)", async (modelGrade) => {
    llm.mockResolvedValueOnce(modelGrade);

    const result = await grade({ variant: VARIANT, studentAnswer: STUDENT_ANSWER });

    expect(result).toEqual(modelGrade);
    expect(llm).toHaveBeenCalledTimes(1);
  });

  it("grades with the fast model", async () => {
    llm.mockResolvedValueOnce({ passed: true, feedback: "Correct." });

    await grade({ variant: VARIANT, studentAnswer: STUDENT_ANSWER });

    expect(callArgs(0).model).toBe("f");
  });

  it("asks the model for an object with passed and feedback", async () => {
    llm.mockResolvedValueOnce({ passed: true, feedback: "Correct." });

    await grade({ variant: VARIANT, studentAnswer: STUDENT_ANSWER });

    const { schema } = callArgs(0);
    expect(schema.safeParse({ passed: true, feedback: "Correct." }).success).toBe(true);
    expect(schema.safeParse({ feedback: "Correct." }).success, 'the schema should require "passed"').toBe(false);
  });

  it("shows the model the student's answer and the variant's reference answer", async () => {
    llm.mockResolvedValueOnce({ passed: false, feedback: "No." });

    await grade({ variant: VARIANT, studentAnswer: STUDENT_ANSWER });

    const prompt = promptOf(0);
    expect(prompt).toContain(STUDENT_ANSWER);
    expect(prompt).toContain(VARIANT.answer);
  });

  it("rejects when the model call fails", async () => {
    llm.mockRejectedValue(new Error("gateway down"));

    await expect(grade({ variant: VARIANT, studentAnswer: STUDENT_ANSWER })).rejects.toThrow();
  });
});

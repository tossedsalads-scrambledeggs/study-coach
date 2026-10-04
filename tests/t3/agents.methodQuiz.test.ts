import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/llm", () => ({
  llmJSON: vi.fn(),
  chat: vi.fn(),
  embed: vi.fn(),
  MODELS: { smart: "s", fast: "f", embed: "e" },
}));
vi.mock("@/lib/db", () => ({ query: vi.fn(), db: vi.fn() }));

import { gradeQuizAnswer, writeQuizQuestion } from "@/lib/agents/methodQuiz";
import { query } from "@/lib/db";
import { chat, embed, llmJSON, MODELS } from "@/lib/llm";
import { makeLine } from "./helpers";

const llmJSONMock = vi.mocked(llmJSON);

/** Arguments the agent passed to the n-th llmJSON call. */
function callArgs(n: number) {
  return llmJSONMock.mock.calls[n][0];
}

/** Everything the model was shown on the n-th call (system + user), for "was this input used" checks. */
function promptOf(n: number): string {
  const args = callArgs(n);
  return `${args.system}\n${args.user}`;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("writeQuizQuestion", () => {
  const line = makeLine({
    trigger: "A problem asks for the variance of a sum of random variables",
    move: "Check independence first, otherwise the covariance term is live",
    trap: "Adding the variances without checking independence",
  });

  it("returns the model's question, trimmed", async () => {
    llmJSONMock.mockResolvedValueOnce({
      question:
        "  A shop's two daily sales totals are tracked. What is the variance of their sum? What is your first move?  \n",
    });
    const result = await writeQuizQuestion(line, []);
    expect(result).toBe(
      "A shop's two daily sales totals are tracked. What is the variance of their sum? What is your first move?",
    );
  });

  it("makes exactly one llmJSON call on the fast model and never calls chat or embed directly", async () => {
    llmJSONMock.mockResolvedValueOnce({
      question: "Fresh scenario number one. What is your first move?",
    });
    await writeQuizQuestion(line, ["An older scenario. What is your first move?"]);
    expect(llmJSONMock).toHaveBeenCalledTimes(1);
    expect(callArgs(0).model).toBe(MODELS.fast);
    expect(chat).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it("asks the model for an object with a string `question`", async () => {
    llmJSONMock.mockResolvedValueOnce({ question: "Fresh scenario. What is your first move?" });
    await writeQuizQuestion(line, []);
    const { schema } = callArgs(0);
    expect(schema.safeParse({ question: "Some scenario. What is your first move?" }).success).toBe(
      true,
    );
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ question: 42 }).success).toBe(false);
    expect(schema.safeParse("just a string").success).toBe(false);
  });

  it("shows the model the line's trigger and every recent question it must not repeat", async () => {
    llmJSONMock.mockResolvedValueOnce({ question: "Brand new scenario. What is your first move?" });
    const recent = [
      "Scenario about coin flips. What is your first move?",
      "Scenario about warehouse orders. What is your first move?",
      "Scenario about exam scores. What is your first move?",
    ];
    await writeQuizQuestion(line, recent);
    const prompt = promptOf(0);
    expect(prompt).toContain(line.trigger);
    for (const q of recent) expect(prompt).toContain(q);
  });

  it("never touches the database", async () => {
    llmJSONMock.mockResolvedValueOnce({ question: "Fresh scenario. What is your first move?" });
    await writeQuizQuestion(line, []);
    expect(query).not.toHaveBeenCalled();
  });

  describe("repeat protection", () => {
    it("retries once when the reply equals a recent question ignoring case, and returns the retry", async () => {
      llmJSONMock
        .mockResolvedValueOnce({ question: "SCENARIO ABOUT COIN FLIPS. what is your first move?" })
        .mockResolvedValueOnce({
          question: "  A completely different scenario. What is your first move?  ",
        });
      const result = await writeQuizQuestion(line, [
        "Scenario about coin flips. What is your first move?",
      ]);
      expect(llmJSONMock).toHaveBeenCalledTimes(2);
      expect(result).toBe("A completely different scenario. What is your first move?");
    });

    it("keeps the retry on the fast model and still asks for { question }", async () => {
      llmJSONMock
        .mockResolvedValueOnce({ question: "scenario about coin flips. what is your first move?" })
        .mockResolvedValueOnce({ question: "Another scenario. What is your first move?" });
      await writeQuizQuestion(line, ["Scenario about coin flips. What is your first move?"]);
      expect(callArgs(1).model).toBe(MODELS.fast);
      expect(callArgs(1).schema.safeParse({ question: "x" }).success).toBe(true);
      expect(callArgs(1).schema.safeParse({}).success).toBe(false);
    });

    it("compares against every recent question, not just the first", async () => {
      const recent = ["Scenario one. Move?", "Scenario two. Move?", "Scenario three. Move?"];
      llmJSONMock
        .mockResolvedValueOnce({ question: "scenario THREE. move?" })
        .mockResolvedValueOnce({ question: "Scenario four. Move?" });
      const result = await writeQuizQuestion(line, recent);
      expect(llmJSONMock).toHaveBeenCalledTimes(2);
      expect(result).toBe("Scenario four. Move?");
    });

    it("retries only once, then returns whatever it got (even a repeat)", async () => {
      llmJSONMock
        .mockResolvedValueOnce({ question: "Scenario about coin flips. What is your first move?" })
        .mockResolvedValueOnce({
          question: "  SCENARIO about coin flips. what is your first move?  ",
        });
      const result = await writeQuizQuestion(line, [
        "scenario about coin flips. what is your first move?",
      ]);
      expect(llmJSONMock).toHaveBeenCalledTimes(2);
      expect(result).toBe("SCENARIO about coin flips. what is your first move?");
    });

    it("does not loop even if the model keeps repeating itself", async () => {
      llmJSONMock.mockResolvedValue({ question: "Same old scenario. What is your first move?" });
      await writeQuizQuestion(line, ["same old scenario. what is your first move?"]);
      expect(llmJSONMock).toHaveBeenCalledTimes(2);
    });

    it("does not retry when the question differs from every recent question", async () => {
      llmJSONMock.mockResolvedValueOnce({
        question: "A scenario nobody has seen. What is your first move?",
      });
      const result = await writeQuizQuestion(line, [
        "Scenario about coin flips. What is your first move?",
        "Scenario about exam scores. What is your first move?",
      ]);
      expect(llmJSONMock).toHaveBeenCalledTimes(1);
      expect(result).toBe("A scenario nobody has seen. What is your first move?");
    });

    it("does not retry when there are no recent questions", async () => {
      llmJSONMock.mockResolvedValueOnce({
        question: "First ever scenario. What is your first move?",
      });
      await writeQuizQuestion(line, []);
      expect(llmJSONMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("gradeQuizAnswer", () => {
  const line = makeLine({
    trigger: "A problem asks for the variance of a sum of random variables",
    move: "Check independence first, otherwise the covariance term is live",
    trap: "Adding the variances without checking independence",
  });
  const question =
    "Two dice totals are added. What is the variance of the sum? What is your first move?";
  const answer = "I would check whether the two are independent before doing anything else";

  it("returns the model's passing grade", async () => {
    llmJSONMock.mockResolvedValueOnce({
      passed: true,
      feedback: "Right: check independence first.",
    });
    const grade = await gradeQuizAnswer(line, question, answer);
    expect(grade).toEqual({ passed: true, feedback: "Right: check independence first." });
  });

  it("returns the model's failing grade, feedback included", async () => {
    llmJSONMock.mockResolvedValueOnce({
      passed: false,
      feedback:
        "The move is to check independence first. You added variances straight away, which is the trap.",
    });
    const grade = await gradeQuizAnswer(line, question, "Just add Var(X) and Var(Y)");
    expect(grade.passed).toBe(false);
    expect(grade.feedback).toBe(
      "The move is to check independence first. You added variances straight away, which is the trap.",
    );
  });

  it("makes exactly one llmJSON call on the fast model and never calls chat or embed directly", async () => {
    llmJSONMock.mockResolvedValueOnce({ passed: true, feedback: "ok" });
    await gradeQuizAnswer(line, question, answer);
    expect(llmJSONMock).toHaveBeenCalledTimes(1);
    expect(callArgs(0).model).toBe(MODELS.fast);
    expect(chat).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it("asks the model for a Grade: { passed: boolean, feedback: string }", async () => {
    llmJSONMock.mockResolvedValueOnce({ passed: true, feedback: "ok" });
    await gradeQuizAnswer(line, question, answer);
    const { schema } = callArgs(0);
    expect(schema.safeParse({ passed: true, feedback: "Good." }).success).toBe(true);
    expect(schema.safeParse({ passed: false, feedback: "Not quite." }).success).toBe(true);
    expect(schema.safeParse({ feedback: "no verdict" }).success).toBe(false);
    expect(schema.safeParse({ passed: "yes", feedback: "wrong type" }).success).toBe(false);
    expect(schema.safeParse("passed").success).toBe(false);
  });

  it("shows the grader the move, the trap, the question and the student's answer", async () => {
    llmJSONMock.mockResolvedValueOnce({ passed: true, feedback: "ok" });
    await gradeQuizAnswer(line, question, answer);
    const prompt = promptOf(0);
    expect(prompt).toContain(line.move);
    expect(prompt).toContain(line.trap);
    expect(prompt).toContain(question);
    expect(prompt).toContain(answer);
  });

  it("never touches the database", async () => {
    llmJSONMock.mockResolvedValueOnce({ passed: true, feedback: "ok" });
    await gradeQuizAnswer(line, question, answer);
    expect(query).not.toHaveBeenCalled();
  });
});

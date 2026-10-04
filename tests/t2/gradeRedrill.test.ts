import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GradeRedrill } from "@/lib/contracts";
import { gradeRedrill } from "@/lib/agents/errorCoach";
import { query } from "@/lib/db";
import { chat, llmJSON } from "@/lib/llm";
import { gradeInput } from "./helpers";

vi.mock("@/lib/llm", () => ({
  llmJSON: vi.fn(),
  chat: vi.fn(),
  embed: vi.fn(),
  MODELS: { smart: "s", fast: "f", embed: "e" },
}));
// Agents never touch the database (PLAN section 6); a call to query() would be a bug.
vi.mock("@/lib/db", () => ({ query: vi.fn(), db: vi.fn() }));

const llm = vi.mocked(llmJSON);

beforeEach(() => {
  vi.resetAllMocks();
});

/** Run once with a passing reply and hand back what the agent sent to the model. */
async function sentToModel(input = gradeInput()) {
  llm.mockResolvedValue({ passed: true, feedback: "ok" } as never);
  await gradeRedrill(input);
  expect(llm).toHaveBeenCalledTimes(1);
  const args = llm.mock.calls[0][0];
  return { args, prompt: `${args.system}\n${args.user}` };
}

describe("gradeRedrill", () => {
  it("is exported with the GradeRedrill signature", () => {
    const fn: GradeRedrill = gradeRedrill;
    expect(typeof fn).toBe("function");
  });

  it("returns {passed: true, feedback} when the model passes the answer", async () => {
    llm.mockResolvedValue({ passed: true, feedback: "Right method and the right result." } as never);

    const grade = await gradeRedrill(gradeInput());

    expect(grade).toEqual({ passed: true, feedback: "Right method and the right result." });
  });

  it("returns {passed: false, feedback} when the model fails the answer", async () => {
    llm.mockResolvedValue({ passed: false, feedback: "Right result, but you did not use the covariance term." } as never);

    const grade = await gradeRedrill(gradeInput({ studentAnswer: "13" }));

    expect(grade).toEqual({ passed: false, feedback: "Right result, but you did not use the covariance term." });
  });

  it("makes one llmJSON call, on the fast model", async () => {
    const { args } = await sentToModel();

    expect(typeof args.system).toBe("string");
    expect(typeof args.user).toBe("string");
    // Grading uses MODELS.fast; the default (MODELS.smart) would be wrong here.
    expect(args.model).toBe("f");
  });

  it("asks for the Grade shape: the schema accepts {passed, feedback} and rejects an empty reply", async () => {
    const { args } = await sentToModel();

    expect(args.schema.safeParse({ passed: true, feedback: "Nice work." }).success).toBe(true);
    expect(args.schema.safeParse({ passed: false, feedback: "Not quite." }).success).toBe(true);
    expect(args.schema.safeParse({}).success).toBe(false);
    expect(args.schema.safeParse({ feedback: "no verdict" }).success).toBe(false);
  });

  it("works when the problem has no reference answer", async () => {
    llm.mockResolvedValue({ passed: true, feedback: "ok" } as never);

    const grade = await gradeRedrill(gradeInput({ problem: { statement: gradeInput().problem.statement, answer: null } }));

    expect(grade).toEqual({ passed: true, feedback: "ok" });
  });

  it("never touches the database", async () => {
    await sentToModel();

    expect(vi.mocked(query)).not.toHaveBeenCalled();
    expect(vi.mocked(chat)).not.toHaveBeenCalled();
  });

  it("does not swallow a model failure (a gateway outage must not become a failed re-drill)", async () => {
    llm.mockRejectedValue(new Error("AI Gateway 503"));

    await expect(gradeRedrill(gradeInput())).rejects.toThrow();
  });

  // Heuristics on the prompt wording: a failure means the criterion is not visibly in the prompt.
  describe("prompt content", () => {
    it("carries the problem, the reference answer, the correct approach and the student's answer", async () => {
      const input = gradeInput();

      const { prompt } = await sentToModel(input);

      expect(prompt).toContain(input.problem.statement);
      expect(prompt).toContain(input.problem.answer as string);
      expect(prompt).toContain(input.correctApproach);
      expect(prompt).toContain(input.studentAnswer);
    });

    it("says an answer passes only if it follows the correct approach and reaches the right result", async () => {
      const { prompt } = await sentToModel();

      expect(prompt).toMatch(/approach/i);
      expect(prompt).toMatch(/result|final answer/i);
      expect(prompt).toMatch(/only (if|when)|both|must|requires?|unless|and reaches?/i);
    });

    it("describes the JSON keys of the Grade it expects", async () => {
      const { prompt } = await sentToModel();

      expect(prompt).toContain("passed");
      expect(prompt).toContain("feedback");
    });
  });
});

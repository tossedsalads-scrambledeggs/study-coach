import { beforeEach, describe, expect, it, vi } from "vitest";
import { ERROR_TYPES, type DiagnoseError } from "@/lib/contracts";
import { diagnoseError } from "@/lib/agents/errorCoach";
import { query } from "@/lib/db";
import { chat, llmJSON } from "@/lib/llm";
import { needsMethodLine } from "@/lib/rules";
import { diagnoseInput, LINE, rawDiagnosis } from "./helpers";

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

/** The mocked model replies with `raw`; then run the agent. Async, so a synchronous throw still counts as a rejection. */
async function diagnose(raw: unknown, input = diagnoseInput()) {
  llm.mockResolvedValue(raw as never);
  return diagnoseError(input);
}

/** Run once with a well-formed reply and hand back what the agent sent to the model. */
async function sentToModel(input = diagnoseInput()) {
  await diagnose(rawDiagnosis(), input);
  expect(llm).toHaveBeenCalledTimes(1);
  const args = llm.mock.calls[0][0];
  return { args, prompt: `${args.system}\n${args.user}` };
}

describe("diagnoseError: invariants enforced in code on whatever the model returns", () => {
  it("is exported with the DiagnoseError signature", () => {
    const fn: DiagnoseError = diagnoseError;
    expect(typeof fn).toBe("function");
  });

  it("passes the model's explanation, correct approach and lesson through", async () => {
    const raw = rawDiagnosis();

    const out = await diagnose(raw);

    expect(out).toMatchObject({
      whatWentWrong: raw.whatWentWrong,
      correctApproach: raw.correctApproach,
      lesson: raw.lesson,
    });
  });

  describe("methodLine is null exactly when needsMethodLine(errorTypes) is false", () => {
    it("pure computational slip + a method line from the model -> methodLine is null", async () => {
      const out = await diagnose(
        rawDiagnosis({ errorTypes: ["computational_slip"], primaryErrorType: "computational_slip", methodLine: { ...LINE } }),
      );

      expect(out.methodLine).toBeNull();
      expect(out.errorTypes).toEqual(["computational_slip"]);
      expect(out.primaryErrorType).toBe("computational_slip");
    });

    it("a repeated computational slip is still a pure slip -> methodLine is null", async () => {
      const out = await diagnose(
        rawDiagnosis({
          errorTypes: ["computational_slip", "computational_slip"],
          primaryErrorType: "computational_slip",
          methodLine: { ...LINE },
        }),
      );

      expect(out.errorTypes).toEqual(["computational_slip"]);
      expect(out.methodLine).toBeNull();
    });

    it("a slip plus an invalid type string is still a pure slip once the invalid one is dropped -> methodLine is null", async () => {
      const out = await diagnose(
        rawDiagnosis({
          errorTypes: ["computational_slip", "careless_mistake"],
          primaryErrorType: "computational_slip",
          methodLine: { ...LINE },
        }),
      );

      expect(out.errorTypes).toEqual(["computational_slip"]);
      expect(out.methodLine).toBeNull();
    });

    it("concept_gap with a method line -> the line is kept as the model wrote it", async () => {
      const out = await diagnose(
        rawDiagnosis({ errorTypes: ["concept_gap"], primaryErrorType: "concept_gap", methodLine: { ...LINE } }),
      );

      expect(out.methodLine).toEqual(LINE);
    });

    it.each(["concept_gap", "wrong_tool", "misread_setup"] as const)("%s on its own keeps the method line", async (type) => {
      const out = await diagnose(rawDiagnosis({ errorTypes: [type], primaryErrorType: type, methodLine: { ...LINE } }));

      expect(out.errorTypes).toEqual([type]);
      expect(out.methodLine).toEqual(LINE);
    });

    it("a computational slip together with another type is not a pure slip -> the line is kept", async () => {
      const out = await diagnose(
        rawDiagnosis({
          errorTypes: ["computational_slip", "wrong_tool"],
          primaryErrorType: "computational_slip",
          methodLine: { ...LINE },
        }),
      );

      expect([...out.errorTypes].sort()).toEqual(["computational_slip", "wrong_tool"]);
      expect(out.methodLine).toEqual(LINE);
    });

    it("a pure slip with methodLine already null stays null (no line needed, none returned)", async () => {
      const out = await diagnose(
        rawDiagnosis({ errorTypes: ["computational_slip"], primaryErrorType: "computational_slip", methodLine: null }),
      );

      expect(out.methodLine).toBeNull();
    });
  });

  describe("rejects when a method line is needed and the model returned none", () => {
    it.each([
      ["concept_gap, methodLine null", ["concept_gap"], "concept_gap", null],
      ["wrong_tool, methodLine null", ["wrong_tool"], "wrong_tool", null],
      ["misread_setup, methodLine null", ["misread_setup"], "misread_setup", null],
      ["concept_gap, methodLine missing", ["concept_gap"], "concept_gap", undefined],
      ["slip + wrong_tool, methodLine null", ["computational_slip", "wrong_tool"], "computational_slip", null],
      // the primary type is merged into errorTypes first, so this is a slip + wrong_tool diagnosis
      ["slip listed but wrong_tool primary, methodLine null", ["computational_slip"], "wrong_tool", null],
    ])("%s", async (_name, errorTypes, primaryErrorType, methodLine) => {
      await expect(diagnose(rawDiagnosis({ errorTypes, primaryErrorType, methodLine }))).rejects.toThrow();
    });
  });

  describe("errorTypes", () => {
    it("always includes primaryErrorType: wrong_tool missing from [concept_gap] is added", async () => {
      const out = await diagnose(rawDiagnosis({ errorTypes: ["concept_gap"], primaryErrorType: "wrong_tool" }));

      expect(out.primaryErrorType).toBe("wrong_tool");
      expect(out.errorTypes).toContain("wrong_tool");
      expect(out.errorTypes).toContain("concept_gap");
    });

    it("an empty list becomes [primaryErrorType]", async () => {
      const out = await diagnose(rawDiagnosis({ errorTypes: [], primaryErrorType: "misread_setup" }));

      expect(out.errorTypes).toEqual(["misread_setup"]);
      expect(out.methodLine).toEqual(LINE);
    });

    it("duplicates are removed", async () => {
      const out = await diagnose(
        rawDiagnosis({
          errorTypes: ["concept_gap", "wrong_tool", "concept_gap", "wrong_tool", "concept_gap"],
          primaryErrorType: "concept_gap",
        }),
      );

      expect(out.errorTypes).toHaveLength(2);
      expect([...out.errorTypes].sort()).toEqual(["concept_gap", "wrong_tool"]);
    });

    it("a primary that is also listed is not duplicated", async () => {
      const out = await diagnose(rawDiagnosis({ errorTypes: ["wrong_tool", "concept_gap"], primaryErrorType: "wrong_tool" }));

      expect(out.errorTypes.filter((t) => t === "wrong_tool")).toHaveLength(1);
      expect(out.errorTypes).toHaveLength(2);
    });

    it("strings that are not one of the 4 error types are dropped", async () => {
      const out = await diagnose(
        rawDiagnosis({
          errorTypes: ["concept_gap", "careless_mistake", "not_a_type", 7, null],
          primaryErrorType: "concept_gap",
        }),
      );

      expect(out.errorTypes).toEqual(["concept_gap"]);
    });

    it("keeps every valid type when all four are reported", async () => {
      const out = await diagnose(rawDiagnosis({ errorTypes: [...ERROR_TYPES], primaryErrorType: "misread_setup" }));

      expect([...out.errorTypes].sort()).toEqual([...ERROR_TYPES].sort());
    });
  });

  describe("whatever the model returns, the Diagnosis contract holds", () => {
    const cases: [string, Record<string, unknown>][] = [
      ["single concept gap", { errorTypes: ["concept_gap"], primaryErrorType: "concept_gap" }],
      ["all four types", { errorTypes: [...ERROR_TYPES], primaryErrorType: "misread_setup" }],
      ["primary missing from the list", { errorTypes: ["concept_gap"], primaryErrorType: "wrong_tool" }],
      ["empty list", { errorTypes: [], primaryErrorType: "misread_setup" }],
      ["duplicates", { errorTypes: ["wrong_tool", "wrong_tool", "concept_gap"], primaryErrorType: "wrong_tool" }],
      ["junk strings", { errorTypes: ["careless", "", "concept_gap", "slip"], primaryErrorType: "concept_gap" }],
      ["slip + other, slip primary", { errorTypes: ["computational_slip", "wrong_tool"], primaryErrorType: "computational_slip" }],
      ["pure slip", { errorTypes: ["computational_slip"], primaryErrorType: "computational_slip" }],
      ["slip + junk", { errorTypes: ["computational_slip", "sloppy"], primaryErrorType: "computational_slip" }],
    ];

    it.each(cases)("%s", async (_name, overrides) => {
      const out = await diagnose(rawDiagnosis(overrides));

      expect(out.errorTypes.length).toBeGreaterThan(0);
      expect(new Set(out.errorTypes).size).toBe(out.errorTypes.length);
      for (const type of out.errorTypes) expect(ERROR_TYPES).toContain(type);
      expect(out.errorTypes).toContain(out.primaryErrorType);
      if (needsMethodLine(out.errorTypes)) {
        expect(out.methodLine).toEqual(LINE);
      } else {
        expect(out.methodLine).toBeNull();
      }
    });
  });
});

describe("diagnoseError: the model call", () => {
  it("makes one llmJSON call, on the smart model", async () => {
    const { args } = await sentToModel();

    expect(typeof args.system).toBe("string");
    expect(typeof args.user).toBe("string");
    // MODELS.smart is the default model; passing it explicitly is also fine. MODELS.fast would be wrong for diagnosis.
    expect([undefined, "s"]).toContain(args.model);
  });

  it("asks for the Diagnosis shape: the schema accepts a well-formed reply and rejects an empty one", async () => {
    const { args } = await sentToModel();

    expect(args.schema.safeParse(rawDiagnosis()).success).toBe(true);
    expect(
      args.schema.safeParse(
        rawDiagnosis({ errorTypes: ["computational_slip"], primaryErrorType: "computational_slip", methodLine: null }),
      ).success,
    ).toBe(true);
    expect(args.schema.safeParse({}).success).toBe(false);
  });

  it("never touches the database", async () => {
    await sentToModel();

    expect(vi.mocked(query)).not.toHaveBeenCalled();
    expect(vi.mocked(chat)).not.toHaveBeenCalled();
  });

  it("does not swallow a model failure", async () => {
    llm.mockRejectedValue(new Error("AI Gateway 503"));

    await expect(diagnoseError(diagnoseInput())).rejects.toThrow();
  });

  it("works with no existing method lines and with no reference answer", async () => {
    const input = diagnoseInput({
      existingLines: [],
      problem: { ...diagnoseInput().problem, answer: null, lecture: null },
    });

    const out = await diagnose(rawDiagnosis(), input);

    expect(out.primaryErrorType).toBe("concept_gap");
  });

  // The next tests check the prompt text. They are heuristics on wording: a failure means the
  // criterion is not visibly in the prompt, not necessarily that the behavior is wrong.
  describe("prompt content", () => {
    it("carries the problem, the reference answer and the student's approach", async () => {
      const input = diagnoseInput();

      const { prompt } = await sentToModel(input);

      expect(prompt).toContain(input.problem.statement);
      expect(prompt).toContain(input.problem.answer as string);
      expect(prompt).toContain(input.studentApproach);
    });

    it("names all four error types", async () => {
      const { prompt } = await sentToModel();

      for (const type of ERROR_TYPES) expect(prompt).toContain(type);
    });

    it("uses the PLAN section 6 definitions of the error types", async () => {
      const { prompt } = await sentToModel();

      expect(prompt).toMatch(/misunderstand|what an idea means|when it applies/i); // concept gap
      expect(prompt).toMatch(/arithmetic|algebra/i); // computational slip
      expect(prompt).toMatch(/formula|technique/i); // wrong tool
      expect(prompt).toMatch(/different problem|missed a condition/i); // misread setup
    });

    it("states the RULE: a method line is actionable inside a problem and generic, not true-in-general", async () => {
      const { prompt } = await sentToModel();

      expect(prompt).toMatch(/actionable/i);
      expect(prompt).toMatch(/generic|reusable|any problem|not about one specific problem/i);
    });

    it("shows the existing method lines so the model can avoid a near-copy", async () => {
      const existingLines = [
        { trigger: "A problem gives a conditional probability and asks for the reverse", move: "Write Bayes' rule and name the prior before plugging in" },
        { trigger: "A problem counts outcomes where order might not matter", move: "Decide ordered vs unordered before choosing a formula" },
      ];

      const { prompt } = await sentToModel(diagnoseInput({ existingLines }));

      for (const line of existingLines) {
        expect(prompt).toContain(line.trigger);
        expect(prompt).toContain(line.move);
      }
      expect(prompt).toMatch(/duplicate|near.?cop|similar|already|existing|overlap/i);
    });

    it("describes the JSON keys of the Diagnosis it expects", async () => {
      const { prompt } = await sentToModel();

      for (const key of ["whatWentWrong", "correctApproach", "errorTypes", "primaryErrorType", "lesson", "methodLine", "trigger", "move", "trap"]) {
        expect(prompt).toContain(key);
      }
    });
  });
});

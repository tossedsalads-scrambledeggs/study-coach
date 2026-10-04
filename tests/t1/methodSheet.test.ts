import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MethodLineDraft } from "@/lib/contracts";

// seedMethodLines is a pure agent: mock the model gateway, hand it flawed drafts, check what comes out.
vi.mock("@/lib/llm", () => ({
  llmJSON: vi.fn(),
  chat: vi.fn(),
  embed: vi.fn(),
  MODELS: { smart: "s", fast: "f", embed: "e" },
}));

import { seedMethodLines } from "@/lib/agents/methodSheet";
import { llmJSON } from "@/lib/llm";
import { makeDraft, makeUnits } from "./fixtures";

const COURSE_TITLE = "Intro to Probability";
const MATERIALS =
  "MATERIALS-MARKER-5d1e Lecture 2 notes: counting with identical objects, symmetry factors.";
const UNIT_NUMBERS = [1, 2, 3];

/** The model answers with { lines: MethodLineDraft[] }. */
function modelReturns(lines: MethodLineDraft[]): void {
  vi.mocked(llmJSON).mockResolvedValue({ lines });
}

/** Everything the agent sent to the model (system and user text), for data-flow checks. Not about wording. */
function promptSentToModel(): string {
  const calls = vi.mocked(llmJSON).mock.calls;
  expect(calls.length, "seedMethodLines never called llmJSON").toBeGreaterThan(0);
  return calls.map(([args]) => `${args.system}\n${args.user}`).join("\n");
}

const seed = (materials: string | undefined = MATERIALS) =>
  seedMethodLines({ courseTitle: COURSE_TITLE, units: makeUnits(), materials });

const wellFormed = (): MethodLineDraft[] => [
  makeDraft(1, "Lec 2", "u1-a"),
  makeDraft(1, "Lec 3", "u1-b"),
  makeDraft(2, "Lec 6", "u2-a"),
  makeDraft(2, "Lec 7", "u2-b"),
  makeDraft(3, "Lec 9", "u3-a"),
  makeDraft(3, "Lec 11", "u3-b"),
];

beforeEach(() => {
  vi.resetAllMocks();
  modelReturns(wellFormed());
});

describe("seedMethodLines: drafts that come back", () => {
  it("returns an array of drafts, all for units that exist in the input", async () => {
    modelReturns([
      ...wellFormed(),
      makeDraft(99, "Lec 40", "ghost-99"),
      makeDraft(0, "Lec 0", "ghost-0"),
      makeDraft(-1, "Lec 0", "ghost-neg"),
    ]);

    const out = await seed();

    expect(Array.isArray(out)).toBe(true);
    expect(out.length).toBeGreaterThan(0);
    for (const d of out) expect(UNIT_NUMBERS, `draft "${d.trigger}"`).toContain(d.unitNumber);
  });

  it("keeps well-formed drafts as the model wrote them", async () => {
    const good = wellFormed();
    modelReturns(good);

    const out = await seed();

    expect(out).toHaveLength(good.length);
    expect(out).toEqual(expect.arrayContaining(good.map((g) => expect.objectContaining(g))));
  });

  it("never returns a draft with a blank trigger, move or trap", async () => {
    const ok = [makeDraft(2, "Lec 6", "ok-1"), makeDraft(3, "Lec 9", "ok-2")];
    modelReturns([
      ...ok,
      { ...makeDraft(2, "Lec 7", "blank-trap"), trap: "" },
      { ...makeDraft(2, "Lec 8", "blank-trigger"), trigger: "   " },
      { ...makeDraft(3, "Lec 10", "blank-move"), move: "" },
    ]);

    const out = await seed();

    for (const d of out) {
      for (const [field, text] of [
        ["trigger", d.trigger],
        ["move", d.move],
        ["trap", d.trap],
      ] as const) {
        expect(
          typeof text === "string" && text.trim().length > 0,
          `${field} of "${d.trigger}"`,
        ).toBe(true);
      }
    }
    expect(out.map((d) => d.trigger)).toEqual(expect.arrayContaining(ok.map((d) => d.trigger)));
  });

  it("returns at most 4 drafts for a unit (acceptance: 2-4 lines per unit) and does not trim smaller sets", async () => {
    const six = Array.from({ length: 6 }, (_, i) => makeDraft(1, `Lec ${i + 1}`, `six-${i}`));
    const three = [
      makeDraft(2, "Lec 6", "three-0"),
      makeDraft(2, "Lec 7", "three-1"),
      makeDraft(2, "Lec 8", "three-2"),
    ];
    modelReturns([...six, ...three]);

    const out = await seed();

    const unit1 = out.filter((d) => d.unitNumber === 1).length;
    expect(unit1).toBeGreaterThanOrEqual(2);
    expect(unit1).toBeLessThanOrEqual(4);
    expect(out.filter((d) => d.unitNumber === 2)).toHaveLength(3);
  });
});

describe("seedMethodLines: what the model is told", () => {
  it("sends the model every unit's title and the course materials", async () => {
    await seed();

    const prompt = promptSentToModel();
    for (const u of makeUnits()) expect(prompt, `unit "${u.title}"`).toContain(u.title);
    expect(prompt).toContain("MATERIALS-MARKER-5d1e");
  });

  it("works without materials and does not leak 'undefined' into the prompt", async () => {
    const out = await seedMethodLines({ courseTitle: COURSE_TITLE, units: makeUnits() });

    expect(out.length).toBeGreaterThan(0);
    expect(promptSentToModel()).not.toContain("undefined");
  });

  it("plans with a model call whose zod schema accepts { lines: MethodLineDraft[] }", async () => {
    await seed();

    // the mocked llmJSON skips validation, so check the schema itself: a real model answer in this shape must parse
    const [args] = vi.mocked(llmJSON).mock.calls[0];
    const parsed = args.schema.safeParse({ lines: wellFormed() });
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });
});

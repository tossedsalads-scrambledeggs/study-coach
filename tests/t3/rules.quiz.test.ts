import { describe, expect, it } from "vitest";
import type { MethodLine } from "@/lib/contracts";
import { pickQuizLine, quizPool } from "@/lib/rules";
import { makeLine } from "./helpers";

/**
 * Spec (docs/PLAN.md section 1.3 and issue #4): the quiz asks only lines that are approved (`active`),
 * not yet passed, and from a unit the student has reached (`unitNumber <= current unit`).
 * A failed attempt does not retire a line; one pass does. The same line is not asked twice in a row
 * when another line is available.
 */

const PASSED_AT = "2026-10-01T10:00:00.000Z";

const lines: MethodLine[] = [
  makeLine({ id: "u1-open", unitNumber: 1 }),
  makeLine({ id: "u2-open", unitNumber: 2 }),
  makeLine({ id: "u3-open", unitNumber: 3 }),
  makeLine({ id: "u1-passed", unitNumber: 1, passedAt: PASSED_AT }),
  makeLine({ id: "u3-passed", unitNumber: 3, passedAt: PASSED_AT }),
  makeLine({ id: "u2-pending", unitNumber: 2, status: "pending", origin: "error" }),
  makeLine({ id: "u3-rejected", unitNumber: 3, status: "rejected", origin: "error" }),
  makeLine({ id: "u4-open", unitNumber: 4 }),
  makeLine({ id: "u5-open", unitNumber: 5 }),
];

const ids = (list: MethodLine[]) => list.map((l) => l.id).sort();

/** 100 evenly spaced values in [0, 1): enough to reach every index of a small pool. */
const SWEEP = Array.from({ length: 100 }, (_, i) => i / 100);

describe("quizPool", () => {
  it("keeps active, unpassed lines from the current unit and earlier units", () => {
    expect(ids(quizPool(lines, 3))).toEqual(["u1-open", "u2-open", "u3-open"]);
  });

  it("includes lines whose unit equals the current unit, and excludes the next unit", () => {
    expect(ids(quizPool(lines, 1))).toEqual(["u1-open"]);
    expect(ids(quizPool(lines, 2))).toEqual(["u1-open", "u2-open"]);
  });

  it("excludes lines from units above the current unit", () => {
    const pool = quizPool(lines, 3);
    expect(pool.every((l) => l.unitNumber <= 3)).toBe(true);
    expect(ids(pool)).not.toContain("u4-open");
    expect(ids(pool)).not.toContain("u5-open");
  });

  it("brings later units in as the current unit advances", () => {
    expect(ids(quizPool(lines, 5))).toEqual([
      "u1-open",
      "u2-open",
      "u3-open",
      "u4-open",
      "u5-open",
    ]);
  });

  it("excludes lines that have been passed", () => {
    const pool = quizPool(lines, 3);
    expect(ids(pool)).not.toContain("u1-passed");
    expect(ids(pool)).not.toContain("u3-passed");
  });

  it("excludes pending lines (not approved yet) and rejected lines", () => {
    const pool = quizPool(lines, 5);
    expect(ids(pool)).not.toContain("u2-pending");
    expect(ids(pool)).not.toContain("u3-rejected");
    expect(pool.every((l) => l.status === "active")).toBe(true);
  });

  it("keeps a line in the pool until it is passed, then drops it (one pass retires a line)", () => {
    expect(ids(quizPool(lines, 3))).toContain("u2-open");
    const afterPass = lines.map((l) => (l.id === "u2-open" ? { ...l, passedAt: PASSED_AT } : l));
    expect(ids(quizPool(afterPass, 3))).toEqual(["u1-open", "u3-open"]);
  });

  it("is empty when no line is eligible", () => {
    expect(quizPool([], 3)).toEqual([]);
    const none = [
      makeLine({ id: "a", passedAt: PASSED_AT }),
      makeLine({ id: "b", status: "pending" }),
      makeLine({ id: "c", status: "rejected" }),
      makeLine({ id: "d", unitNumber: 9 }),
    ];
    expect(quizPool(none, 2)).toEqual([]);
  });

  it("does not modify the lines it is given", () => {
    const frozen = Object.freeze(lines.map((l) => Object.freeze({ ...l })));
    expect(() => quizPool(frozen as MethodLine[], 3)).not.toThrow();
    expect(frozen).toHaveLength(lines.length);
  });
});

describe("pickQuizLine", () => {
  it("returns null when the pool is empty", () => {
    expect(pickQuizLine([], 3, null)).toBeNull();
    const ineligible = [
      makeLine({ id: "a", passedAt: PASSED_AT }),
      makeLine({ id: "b", status: "pending" }),
      makeLine({ id: "c", status: "rejected" }),
      makeLine({ id: "d", unitNumber: 9 }),
    ];
    expect(pickQuizLine(ineligible, 2, null)).toBeNull();
    expect(pickQuizLine(ineligible, 2, "a", () => 0.5)).toBeNull();
  });

  it.each([1, 2, 3, 5])("only ever returns an eligible line (current unit %i)", (current) => {
    const eligible = new Set(quizPool(lines, current).map((l) => l.id));
    for (const r of SWEEP) {
      const picked = pickQuizLine(lines, current, null, () => r);
      expect(picked).not.toBeNull();
      expect(eligible.has(picked!.id)).toBe(true);
    }
  });

  it("never returns passed, pending, rejected or too-advanced lines", () => {
    const banned = new Set([
      "u1-passed",
      "u3-passed",
      "u2-pending",
      "u3-rejected",
      "u4-open",
      "u5-open",
    ]);
    for (const r of SWEEP) {
      expect(banned.has(pickQuizLine(lines, 3, null, () => r)!.id)).toBe(false);
    }
  });

  it("is random across the whole eligible pool: every eligible line can be picked", () => {
    const seen = new Set(SWEEP.map((r) => pickQuizLine(lines, 3, null, () => r)!.id));
    expect([...seen].sort()).toEqual(["u1-open", "u2-open", "u3-open"]);
  });

  it("avoids an immediate repeat when another line is available", () => {
    for (const r of SWEEP) {
      expect(pickQuizLine(lines, 3, "u2-open", () => r)!.id).not.toBe("u2-open");
    }
  });

  it("still reaches every other eligible line when it avoids the last one", () => {
    const seen = new Set(SWEEP.map((r) => pickQuizLine(lines, 3, "u2-open", () => r)!.id));
    expect([...seen].sort()).toEqual(["u1-open", "u3-open"]);
  });

  it("returns the only eligible line even if it was just asked", () => {
    const only = [makeLine({ id: "only" }), makeLine({ id: "gone", passedAt: PASSED_AT })];
    for (const r of SWEEP) {
      expect(pickQuizLine(only, 1, "only", () => r)!.id).toBe("only");
    }
  });

  it("does not let a stale last-asked id (for example a line just passed) restrict the pick", () => {
    const seen = new Set(SWEEP.map((r) => pickQuizLine(lines, 3, "u1-passed", () => r)!.id));
    expect([...seen].sort()).toEqual(["u1-open", "u2-open", "u3-open"]);
    expect(seen.has("u1-passed")).toBe(false);
  });

  it("with two eligible lines, alternates away from the one just asked", () => {
    const two = [makeLine({ id: "a" }), makeLine({ id: "b" })];
    for (const r of SWEEP) {
      expect(pickQuizLine(two, 1, "a", () => r)!.id).toBe("b");
      expect(pickQuizLine(two, 1, "b", () => r)!.id).toBe("a");
    }
  });

  it("works with the default random source", () => {
    const eligible = new Set(["u1-open", "u3-open"]);
    for (let i = 0; i < 200; i++) {
      const picked = pickQuizLine(lines, 3, "u2-open");
      expect(picked).not.toBeNull();
      expect(eligible.has(picked!.id)).toBe(true);
    }
  });

  it("does not modify the lines it is given", () => {
    const frozen = Object.freeze(lines.map((l) => Object.freeze({ ...l })));
    expect(() => pickQuizLine(frozen as MethodLine[], 3, "u1-open", () => 0.5)).not.toThrow();
    expect(frozen).toHaveLength(lines.length);
  });
});

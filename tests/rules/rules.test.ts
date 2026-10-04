import { describe, expect, it } from "vitest";
import { ERROR_TYPES, type ErrorType, type MethodLine, type Unit } from "@/lib/contracts";
import {
  addDays,
  currentUnit,
  needsMethodLine,
  pickQuizLine,
  quizPool,
  redrillDate,
  redrillDays,
  todayISO,
} from "@/lib/rules";

/**
 * Tests for the core rules in lib/rules.ts, written from docs/PLAN.md section 1 and the acceptance
 * criteria of issue #1. Everything is deterministic: dates are passed in explicitly and
 * pickQuizLine gets an injected `random`. The only real-clock call is the todayISO() smoke test.
 */

// ---------------------------------------------------------------------------
// Fixtures and helpers
// ---------------------------------------------------------------------------

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const PASSED_AT = "2026-10-02T18:30:00.000Z";

/** A complete MethodLine (every contract field). Defaults to an approved, unpassed seed line in unit 1. */
function makeLine(id: string, overrides: Partial<MethodLine> = {}): MethodLine {
  return {
    id,
    courseId: "course-1",
    unitNumber: 1,
    lecture: "Lec 1",
    trigger: "Asked for the variance of a sum of random variables",
    move: "Check independence first; if the variables are dependent, include the covariance term",
    trap: "Adding the variances without checking independence",
    source: "U1 Lec 1",
    origin: "seed",
    status: "active",
    errorLogId: null,
    passedAt: null,
    ...overrides,
  };
}

/** A complete Unit (every contract field). Only `number` and `startDate` matter to the rules. */
function makeUnit(number: number, startDate: string | null): Unit {
  return {
    number,
    title: `Unit ${number}`,
    startDate,
    endDate: null,
    lectures: null,
    topics: null,
    estHours: null,
    difficulty: null,
    difficultyReason: null,
  };
}

/** Ids, sorted, so assertions do not depend on the order a pool comes back in. */
const idsOf = (lines: MethodLine[]): string[] => lines.map((line) => line.id).sort();

/** Random values 0.00 .. 0.99 plus one just under 1: sweeps the whole range `random()` can return. */
const RANDOM_SWEEP: number[] = [...Array.from({ length: 100 }, (_, i) => i / 100), 0.9999999999];

/** How often each line id is picked when `random` walks evenly across [0, 1) in 1000 steps. */
function pickCounts(
  lines: MethodLine[],
  current: number,
  lastLineId: string | null,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (let step = 0; step < 1000; step++) {
    const id = pickQuizLine(lines, current, lastLineId, () => step / 1000)?.id ?? "<null>";
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

// ---------------------------------------------------------------------------
// redrillDays
// ---------------------------------------------------------------------------

describe("redrillDays", () => {
  it("is 2 days for a problem from the unit the student is on", () => {
    expect(redrillDays(3, 3)).toBe(2);
  });

  it("is 2 days on the very first unit", () => {
    expect(redrillDays(1, 1)).toBe(2);
  });

  it.each([
    { current: 2, problem: 1 }, // exactly one unit back
    { current: 3, problem: 2 },
    { current: 3, problem: 1 }, // two units back
    { current: 5, problem: 1 },
    { current: 12, problem: 1 }, // far back
  ])(
    "is 7 days for a problem from an earlier unit (on $current, problem from $problem)",
    ({ current, problem }) => {
      expect(redrillDays(current, problem)).toBe(7);
    },
  );

  it.each([
    { current: 1, problem: 2 }, // one unit ahead
    { current: 3, problem: 4 },
    { current: 2, problem: 5 },
    { current: 1, problem: 12 }, // far ahead
  ])(
    "is 2 days for a problem from a later unit (on $current, problem from $problem)",
    ({ current, problem }) => {
      expect(redrillDays(current, problem)).toBe(2);
    },
  );
});

// ---------------------------------------------------------------------------
// addDays
// ---------------------------------------------------------------------------

describe("addDays", () => {
  it("returns the same date for 0 days and the next date for 1 day", () => {
    expect(addDays("2026-10-04", 0)).toBe("2026-10-04");
    expect(addDays("2026-10-04", 1)).toBe("2026-10-05");
  });

  it("stays inside a month", () => {
    expect(addDays("2026-10-04", 2)).toBe("2026-10-06");
    expect(addDays("2026-10-04", 7)).toBe("2026-10-11");
  });

  it("rolls over a month boundary (31-day and 30-day months)", () => {
    expect(addDays("2026-10-30", 2)).toBe("2026-11-01");
    expect(addDays("2026-10-28", 7)).toBe("2026-11-04");
    expect(addDays("2026-09-29", 2)).toBe("2026-10-01");
    expect(addDays("2026-11-28", 7)).toBe("2026-12-05");
  });

  it("lands correctly on the last day of a month", () => {
    expect(addDays("2026-10-24", 7)).toBe("2026-10-31");
    expect(addDays("2026-10-29", 2)).toBe("2026-10-31");
    expect(addDays("2026-11-28", 2)).toBe("2026-11-30");
    expect(addDays("2026-12-29", 2)).toBe("2026-12-31");
    expect(addDays("2026-02-26", 2)).toBe("2026-02-28");
  });

  it("starts correctly from the last day of a month", () => {
    expect(addDays("2026-10-31", 0)).toBe("2026-10-31");
    expect(addDays("2026-10-31", 7)).toBe("2026-11-07");
    expect(addDays("2026-01-31", 28)).toBe("2026-02-28");
    expect(addDays("2026-01-31", 30)).toBe("2026-03-02");
  });

  it("rolls over a year boundary", () => {
    expect(addDays("2026-12-30", 7)).toBe("2027-01-06");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-12-31", 2)).toBe("2027-01-02");
  });

  it("handles February in a non-leap year", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(addDays("2026-02-24", 7)).toBe("2026-03-03");
  });

  it("handles February in a leap year", () => {
    expect(addDays("2028-02-27", 2)).toBe("2028-02-29");
    expect(addDays("2028-02-28", 2)).toBe("2028-03-01");
    expect(addDays("2028-02-24", 7)).toBe("2028-03-02");
  });

  it("adds whole years of days", () => {
    expect(addDays("2026-01-01", 365)).toBe("2027-01-01");
    expect(addDays("2028-01-01", 366)).toBe("2029-01-01");
  });

  it("goes backwards for negative days", () => {
    expect(addDays("2027-01-02", -3)).toBe("2026-12-30");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("is not thrown off by daylight saving changes", () => {
    expect(addDays("2026-03-07", 2)).toBe("2026-03-09"); // US clocks spring forward on 2026-03-08
    expect(addDays("2026-10-31", 2)).toBe("2026-11-02"); // US clocks fall back on 2026-11-01
  });

  it("always returns a zero-padded YYYY-MM-DD date", () => {
    expect(addDays("2026-01-01", 8)).toBe("2026-01-09");
    expect(addDays("2026-08-30", 10)).toBe("2026-09-09");
    expect(addDays("2026-05-05", 3)).toMatch(ISO_DATE);
  });
});

// ---------------------------------------------------------------------------
// redrillDate
// ---------------------------------------------------------------------------

describe("redrillDate", () => {
  it("is today + 2 days for a problem from the current unit", () => {
    expect(redrillDate("2026-10-04", 3, 3)).toBe("2026-10-06");
  });

  it("is today + 7 days for a problem from an earlier unit", () => {
    expect(redrillDate("2026-10-04", 3, 2)).toBe("2026-10-11");
    expect(redrillDate("2026-10-04", 3, 1)).toBe("2026-10-11");
  });

  it("is today + 2 days for a problem from a later unit", () => {
    expect(redrillDate("2026-10-04", 3, 4)).toBe("2026-10-06");
    expect(redrillDate("2026-10-04", 1, 9)).toBe("2026-10-06");
  });

  it("is correct across a month boundary", () => {
    expect(redrillDate("2026-10-30", 2, 2)).toBe("2026-11-01"); // +2
    expect(redrillDate("2026-10-28", 4, 2)).toBe("2026-11-04"); // +7
  });

  it("is correct when it lands on the last day of a month", () => {
    expect(redrillDate("2026-10-29", 3, 3)).toBe("2026-10-31"); // +2
    expect(redrillDate("2026-10-24", 3, 1)).toBe("2026-10-31"); // +7
  });

  it("is correct across a year boundary", () => {
    expect(redrillDate("2026-12-30", 4, 1)).toBe("2027-01-06"); // +7
    expect(redrillDate("2026-12-31", 2, 2)).toBe("2027-01-02"); // +2
  });

  it("is correct across a leap-day boundary", () => {
    expect(redrillDate("2028-02-27", 3, 3)).toBe("2028-02-29"); // +2
    expect(redrillDate("2028-02-24", 5, 1)).toBe("2028-03-02"); // +7
  });

  it("is always today plus redrillDays", () => {
    const todays = ["2026-10-04", "2026-12-30", "2028-02-26"];
    for (const today of todays) {
      for (const [current, problem] of [
        [3, 3],
        [3, 2],
        [3, 4],
        [1, 1],
        [6, 1],
      ]) {
        expect(redrillDate(today, current, problem)).toBe(
          addDays(today, redrillDays(current, problem)),
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// currentUnit
// ---------------------------------------------------------------------------

describe("currentUnit", () => {
  // Unit 1 starts 2026-09-01, unit 2 on 09-15, unit 3 on 10-01, unit 4 on 10-20, unit 5 on 11-10.
  const units = [
    makeUnit(1, "2026-09-01"),
    makeUnit(2, "2026-09-15"),
    makeUnit(3, "2026-10-01"),
    makeUnit(4, "2026-10-20"),
    makeUnit(5, "2026-11-10"),
  ];

  describe("manual override", () => {
    it("wins over the unit the dates point to", () => {
      expect(currentUnit(units, "2026-10-04", null)).toBe(3); // sanity: dates say unit 3
      expect(currentUnit(units, "2026-10-04", 2)).toBe(2);
    });

    it("wins when it points at a unit that has not started yet", () => {
      expect(currentUnit(units, "2026-10-04", 5)).toBe(5);
    });

    it("wins before the course starts", () => {
      expect(currentUnit(units, "2026-08-01", 4)).toBe(4);
    });

    it("wins when no unit has a start date, or there are no units", () => {
      expect(currentUnit([makeUnit(1, null), makeUnit(2, null)], "2026-10-04", 2)).toBe(2);
      expect(currentUnit([], "2026-10-04", 3)).toBe(3);
    });

    it("is ignored when null, so the dates decide", () => {
      expect(currentUnit(units, "2026-10-04", null)).toBe(3);
    });
  });

  describe("without an override: the latest unit whose startDate <= today", () => {
    it.each([
      { today: "2026-09-01", expected: 1 }, // unit 1 starts today
      { today: "2026-09-14", expected: 1 }, // the day before unit 2 starts
      { today: "2026-09-15", expected: 2 }, // unit 2 starts today
      { today: "2026-09-30", expected: 2 },
      { today: "2026-10-01", expected: 3 }, // unit 3 starts today
      { today: "2026-10-04", expected: 3 },
      { today: "2026-10-19", expected: 3 }, // the day before unit 4 starts
      { today: "2026-10-20", expected: 4 }, // unit 4 starts today
      { today: "2026-11-09", expected: 4 },
      { today: "2026-11-10", expected: 5 }, // unit 5 starts today
      { today: "2027-02-01", expected: 5 }, // long after the last unit started: stays on it
    ])("on $today the current unit is $expected", ({ today, expected }) => {
      expect(currentUnit(units, today, null)).toBe(expected);
    });

    it("counts a unit that starts today (startDate == today is included)", () => {
      expect(currentUnit(units, "2026-10-20", null)).toBe(4);
      expect(currentUnit(units, "2026-10-19", null)).toBe(3);
    });

    it("does not depend on the order the units are listed in", () => {
      const shuffled = [units[3], units[0], units[4], units[2], units[1]];
      expect(currentUnit(shuffled, "2026-10-04", null)).toBe(3);
      expect(currentUnit(shuffled, "2026-11-10", null)).toBe(5);
      expect(currentUnit(shuffled, "2026-09-01", null)).toBe(1);
    });

    it("compares dates correctly across a year boundary", () => {
      const rows = [
        makeUnit(1, "2026-09-01"),
        makeUnit(2, "2026-12-15"),
        makeUnit(3, "2027-01-05"),
      ];
      expect(currentUnit(rows, "2026-12-31", null)).toBe(2);
      expect(currentUnit(rows, "2027-01-04", null)).toBe(2);
      expect(currentUnit(rows, "2027-01-05", null)).toBe(3);
    });

    it("accepts bare { number, startDate } rows", () => {
      const rows = [
        { number: 1, startDate: "2026-09-01" },
        { number: 2, startDate: "2026-10-01" },
      ];
      expect(currentUnit(rows, "2026-10-04", null)).toBe(2);
    });
  });

  describe("before the course starts", () => {
    it("is unit 1 when every unit starts in the future", () => {
      expect(currentUnit(units, "2026-08-31", null)).toBe(1);
      expect(currentUnit(units, "2025-01-01", null)).toBe(1);
    });

    it("is unit 1 even when the first unit to start is a later number", () => {
      const rows = [makeUnit(2, "2026-11-01"), makeUnit(3, "2026-12-01")];
      expect(currentUnit(rows, "2026-10-04", null)).toBe(1);
    });
  });

  describe("units without a start date", () => {
    it("are ignored, even when they have the highest numbers", () => {
      const rows = [makeUnit(1, "2026-09-01"), makeUnit(2, null), makeUnit(3, null)];
      expect(currentUnit(rows, "2026-10-04", null)).toBe(1);
    });

    it("do not hide a later unit that does have a start date", () => {
      const rows = [makeUnit(1, "2026-09-01"), makeUnit(2, null), makeUnit(3, "2026-09-20")];
      expect(currentUnit(rows, "2026-10-04", null)).toBe(3);
    });

    it("are skipped over when the later dated unit has not started yet", () => {
      const rows = [makeUnit(1, "2026-09-01"), makeUnit(2, null), makeUnit(3, "2026-12-01")];
      expect(currentUnit(rows, "2026-10-04", null)).toBe(1);
    });

    it("are ignored when they come first", () => {
      const rows = [makeUnit(1, null), makeUnit(2, "2026-09-01"), makeUnit(3, "2026-12-01")];
      expect(currentUnit(rows, "2026-10-04", null)).toBe(2);
    });

    it("leave the answer at unit 1 when no unit has a start date", () => {
      const rows = [makeUnit(1, null), makeUnit(2, null), makeUnit(3, null)];
      expect(currentUnit(rows, "2026-10-04", null)).toBe(1);
    });

    it("leave the answer at unit 1 when there are no units at all", () => {
      expect(currentUnit([], "2026-10-04", null)).toBe(1);
    });
  });
});

// ---------------------------------------------------------------------------
// re-drill scheduling, driven by the current unit (PLAN section 1, error log)
// ---------------------------------------------------------------------------

describe("re-drill date for the unit the student is on", () => {
  const units = [makeUnit(1, "2026-09-01"), makeUnit(2, "2026-09-15"), makeUnit(3, "2026-10-01")];
  const today = "2026-10-04";

  it("uses the unit the calendar says the student is on", () => {
    const current = currentUnit(units, today, null); // unit 3
    expect(redrillDate(today, current, 3)).toBe("2026-10-06");
    expect(redrillDate(today, current, 2)).toBe("2026-10-11");
    expect(redrillDate(today, current, 1)).toBe("2026-10-11");
  });

  it("follows a manual override of the current unit", () => {
    const current = currentUnit(units, today, 2); // the student says they are still on unit 2
    expect(redrillDate(today, current, 2)).toBe("2026-10-06"); // current unit
    expect(redrillDate(today, current, 1)).toBe("2026-10-11"); // earlier unit
    expect(redrillDate(today, current, 3)).toBe("2026-10-06"); // later unit
  });
});

// ---------------------------------------------------------------------------
// needsMethodLine
// ---------------------------------------------------------------------------

describe("needsMethodLine", () => {
  it("is false for a pure computational slip", () => {
    expect(needsMethodLine(["computational_slip"])).toBe(false);
  });

  it("is false when every listed type is a computational slip", () => {
    expect(needsMethodLine(["computational_slip", "computational_slip"])).toBe(false);
  });

  it.each(ERROR_TYPES.filter((type) => type !== "computational_slip"))(
    "is true when the only type is %s",
    (type) => {
      expect(needsMethodLine([type])).toBe(true);
    },
  );

  it.each([
    { types: ["computational_slip", "concept_gap"] as ErrorType[] },
    { types: ["concept_gap", "computational_slip"] as ErrorType[] }, // order does not matter
    { types: ["computational_slip", "wrong_tool"] as ErrorType[] },
    { types: ["misread_setup", "computational_slip"] as ErrorType[] },
    { types: ["computational_slip", "wrong_tool", "misread_setup"] as ErrorType[] },
    { types: ["concept_gap", "wrong_tool"] as ErrorType[] }, // no slip involved
    { types: [...ERROR_TYPES] as ErrorType[] }, // all four
  ])("is true for the mix $types", ({ types }) => {
    expect(needsMethodLine(types)).toBe(true);
  });

  it("is false only when every type is a computational slip, across every non-empty combination", () => {
    for (let mask = 1; mask < 1 << ERROR_TYPES.length; mask++) {
      const types: ErrorType[] = ERROR_TYPES.filter((_, i) => mask & (1 << i));
      const allSlips = types.every((type) => type === "computational_slip");
      expect(needsMethodLine(types), types.join(" + ")).toBe(!allSlips);
    }
  });
});

// ---------------------------------------------------------------------------
// quizPool
// ---------------------------------------------------------------------------

describe("quizPool", () => {
  it("keeps only approved (active) lines", () => {
    const lines = [
      makeLine("approved", { status: "active" }),
      makeLine("pending", { status: "pending", origin: "error", errorLogId: "err-1" }),
      makeLine("rejected", { status: "rejected", origin: "error", errorLogId: "err-2" }),
    ];
    expect(idsOf(quizPool(lines, 1))).toEqual(["approved"]);
  });

  it("keeps only lines that have not been passed", () => {
    const lines = [
      makeLine("open", { passedAt: null }),
      makeLine("passed", { passedAt: PASSED_AT }),
    ];
    expect(idsOf(quizPool(lines, 1))).toEqual(["open"]);
  });

  it("keeps only lines from the current unit or earlier", () => {
    const lines = [1, 2, 3, 4, 5].map((unitNumber) => makeLine(`u${unitNumber}`, { unitNumber }));
    expect(idsOf(quizPool(lines, 3))).toEqual(["u1", "u2", "u3"]); // unit == current is in, later is out
    expect(idsOf(quizPool(lines, 1))).toEqual(["u1"]);
    expect(idsOf(quizPool(lines, 5))).toEqual(["u1", "u2", "u3", "u4", "u5"]);
  });

  it("applies all three rules at once", () => {
    // Every combination of status x passed/open x unit below/at/above the current unit (3).
    const lines: MethodLine[] = [];
    for (const status of ["active", "pending", "rejected"] as const) {
      for (const passed of [false, true]) {
        for (const [where, unitNumber] of [
          ["below", 2],
          ["at", 3],
          ["above", 4],
        ] as const) {
          lines.push(
            makeLine(`${status}/${passed ? "passed" : "open"}/${where}`, {
              status,
              passedAt: passed ? PASSED_AT : null,
              unitNumber,
            }),
          );
        }
      }
    }
    expect(lines).toHaveLength(18);
    expect(idsOf(quizPool(lines, 3))).toEqual(["active/open/at", "active/open/below"]);
  });

  it("treats approved error-born lines like seeded ones and leaves pending ones out", () => {
    const lines = [
      makeLine("seed", { origin: "seed" }),
      makeLine("approved-from-error", {
        origin: "error",
        errorLogId: "err-1",
        source: "Error log 2026-09-09",
        status: "active",
      }),
      makeLine("awaiting-approval", { origin: "error", errorLogId: "err-2", status: "pending" }),
    ];
    expect(idsOf(quizPool(lines, 1))).toEqual(["approved-from-error", "seed"]);
  });

  it("is empty when there are no lines or none is eligible", () => {
    expect(quizPool([], 3)).toEqual([]);
    expect(quizPool([makeLine("ahead", { unitNumber: 6 })], 3)).toEqual([]);
    expect(quizPool([makeLine("done", { passedAt: PASSED_AT })], 3)).toEqual([]);
  });

  it("returns the eligible lines themselves, unchanged", () => {
    const line = makeLine("keep", { unitNumber: 2 });
    expect(quizPool([line, makeLine("drop", { status: "rejected" })], 2)).toEqual([line]);
  });
});

// ---------------------------------------------------------------------------
// pickQuizLine
// ---------------------------------------------------------------------------

describe("pickQuizLine", () => {
  const a = makeLine("a");
  const b = makeLine("b");
  const c = makeLine("c");

  describe("empty pool", () => {
    it("returns null when there are no lines", () => {
      expect(pickQuizLine([], 1, null, () => 0.5)).toBeNull();
      expect(pickQuizLine([], 3, "a", () => 0.5)).toBeNull();
    });

    it("returns null when no line is eligible", () => {
      const lines = [
        makeLine("pending", { status: "pending", origin: "error", errorLogId: "err-1" }),
        makeLine("rejected", { status: "rejected", origin: "error", errorLogId: "err-2" }),
        makeLine("passed", { passedAt: PASSED_AT }),
        makeLine("ahead", { unitNumber: 4 }),
      ];
      for (const lastLineId of [null, "passed", "ahead", "nope"]) {
        expect(pickQuizLine(lines, 2, lastLineId, () => 0.5)).toBeNull();
      }
    });
  });

  describe("not repeating the last line", () => {
    it("never returns lastLineId when another choice exists", () => {
      for (const last of ["a", "b", "c"]) {
        for (const random of RANDOM_SWEEP) {
          const picked = pickQuizLine([a, b, c], 1, last, () => random);
          expect(picked, `last=${last} random=${random}`).not.toBeNull();
          expect(picked?.id, `last=${last} random=${random}`).not.toBe(last);
        }
      }
    });

    it("with exactly two eligible lines, always returns the one that was not just asked", () => {
      for (const random of RANDOM_SWEEP) {
        expect(pickQuizLine([a, b], 1, "a", () => random)?.id).toBe("b");
        expect(pickQuizLine([a, b], 1, "b", () => random)?.id).toBe("a");
      }
    });

    it("can still reach every other eligible line", () => {
      const seen = new Set(
        RANDOM_SWEEP.map((random) => pickQuizLine([a, b, c], 1, "b", () => random)?.id),
      );
      expect([...seen].sort()).toEqual(["a", "c"]);
    });

    it("returns the last line when it is the only eligible line", () => {
      for (const random of RANDOM_SWEEP) {
        expect(pickQuizLine([a], 1, "a", () => random)).toEqual(a);
      }
    });

    it("counts only eligible lines when deciding whether there is another choice", () => {
      const lines = [
        a,
        makeLine("pending", { status: "pending" }),
        makeLine("rejected", { status: "rejected" }),
        makeLine("passed", { passedAt: PASSED_AT }),
        makeLine("ahead", { unitNumber: 5 }),
      ];
      for (const random of RANDOM_SWEEP) {
        expect(pickQuizLine(lines, 2, "a", () => random)?.id).toBe("a");
      }
    });

    it("excludes nothing when there is no last line", () => {
      const seen = new Set(
        RANDOM_SWEEP.map((random) => pickQuizLine([a, b, c], 1, null, () => random)?.id),
      );
      expect([...seen].sort()).toEqual(["a", "b", "c"]);
    });

    it("excludes nothing when the last line is no longer in the pool", () => {
      const justPassed = makeLine("just-passed", { passedAt: PASSED_AT });
      const lines = [justPassed, a, b];
      const seen = new Set(
        RANDOM_SWEEP.map((random) => pickQuizLine(lines, 1, "just-passed", () => random)?.id),
      );
      expect([...seen].sort()).toEqual(["a", "b"]);
    });

    it("excludes nothing when the last line id is unknown", () => {
      const seen = new Set(
        RANDOM_SWEEP.map((random) => pickQuizLine([a, b, c], 1, "no-such-line", () => random)?.id),
      );
      expect([...seen].sort()).toEqual(["a", "b", "c"]);
    });
  });

  describe("pool rules", () => {
    it("only ever returns eligible lines, and can reach each of them", () => {
      const lines = [
        makeLine("u1-open", { unitNumber: 1 }),
        makeLine("u2-open", { unitNumber: 2 }),
        makeLine("u2-passed", { unitNumber: 2, passedAt: PASSED_AT }),
        makeLine("u2-pending", { unitNumber: 2, status: "pending" }),
        makeLine("u2-rejected", { unitNumber: 2, status: "rejected" }),
        makeLine("u3-open", { unitNumber: 3 }),
      ];
      const seen = new Set(
        RANDOM_SWEEP.map((random) => pickQuizLine(lines, 2, null, () => random)?.id ?? "<null>"),
      );
      expect([...seen].sort()).toEqual(["u1-open", "u2-open"]);
    });

    it("widens to later units as the current unit advances", () => {
      const lines = [
        makeLine("u1", { unitNumber: 1 }),
        makeLine("u2", { unitNumber: 2 }),
        makeLine("u3", { unitNumber: 3 }),
      ];
      const reachable = (current: number) =>
        [
          ...new Set(
            RANDOM_SWEEP.map((random) => pickQuizLine(lines, current, null, () => random)?.id),
          ),
        ].sort();
      expect(reachable(1)).toEqual(["u1"]);
      expect(reachable(2)).toEqual(["u1", "u2"]);
      expect(reachable(3)).toEqual(["u1", "u2", "u3"]);
    });
  });

  describe("injected random", () => {
    it("is deterministic: the same random value always gives the same line", () => {
      const lines = [a, b, c, makeLine("d")];
      for (const random of RANDOM_SWEEP) {
        const first = pickQuizLine(lines, 1, null, () => random);
        const second = pickQuizLine(lines, 1, null, () => random);
        expect(first).not.toBeNull();
        expect(second).toEqual(first);
      }
    });

    it("is deterministic with a last line to avoid, too", () => {
      const lines = [a, b, c, makeLine("d")];
      for (const random of RANDOM_SWEEP) {
        expect(pickQuizLine(lines, 1, "c", () => random)).toEqual(
          pickQuizLine(lines, 1, "c", () => random),
        );
      }
    });

    it("maps the low end of the range to the first choice and the high end to the last", () => {
      const lines = [a, b, c];
      expect(pickQuizLine(lines, 1, null, () => 0)?.id).toBe("a");
      expect(pickQuizLine(lines, 1, null, () => 0.9999999999)?.id).toBe("c");
      // The line to avoid is not counted as a position.
      expect(pickQuizLine(lines, 1, "a", () => 0)?.id).toBe("b");
      expect(pickQuizLine(lines, 1, "c", () => 0.9999999999)?.id).toBe("b");
    });

    it("always returns a real line for any random value in [0, 1) when the pool is not empty", () => {
      for (const random of RANDOM_SWEEP) {
        for (const last of [null, "a", "b", "c"]) {
          expect(pickQuizLine([a, b, c], 1, last, () => random)).toMatchObject({
            courseId: "course-1",
            status: "active",
          });
        }
      }
    });

    it("is uniform: each eligible line is equally likely across the random range", () => {
      const counts = pickCounts([a, b, c, makeLine("d")], 1, null);
      expect([...counts.keys()].sort()).toEqual(["a", "b", "c", "d"]);
      for (const count of counts.values()) {
        expect(Math.abs(count - 250)).toBeLessThanOrEqual(2);
      }
    });

    it("stays uniform over the remaining lines when the last one is excluded", () => {
      const counts = pickCounts([a, b, c, makeLine("d")], 1, "b");
      expect([...counts.keys()].sort()).toEqual(["a", "c", "d"]);
      for (const count of counts.values()) {
        expect(Math.abs(count - 1000 / 3)).toBeLessThanOrEqual(2);
      }
    });
  });

  describe("default random source", () => {
    it("falls back to Math.random and still returns only eligible lines", () => {
      const lines = [a, b, makeLine("passed", { passedAt: PASSED_AT })];
      for (let attempt = 0; attempt < 50; attempt++) {
        expect(["a", "b"]).toContain(pickQuizLine(lines, 1, null)?.id);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// todayISO
// ---------------------------------------------------------------------------

describe("todayISO", () => {
  it("returns an ISO calendar date for the real clock (smoke test)", () => {
    expect(todayISO()).toMatch(ISO_DATE);
  });

  it("uses the instant it is given instead of the real clock", () => {
    const first = todayISO(new Date("2026-10-04T12:00:00Z"));
    const later = todayISO(new Date("2026-10-06T12:00:00Z"));
    expect(first).toMatch(ISO_DATE);
    expect(later).toBe(addDays(first, 2));
  });

  // lib/rules.ts reads APP_TIMEZONE once at import and defaults to America/Los_Angeles, so these
  // checks only make sense when the environment does not override it.
  describe.skipIf(Boolean(process.env.APP_TIMEZONE))("in the default timezone (Pacific)", () => {
    it("follows Pacific daylight time, not UTC", () => {
      expect(todayISO(new Date("2026-10-05T03:00:00Z"))).toBe("2026-10-04"); // 8 PM PDT, Oct 4
      expect(todayISO(new Date("2026-07-01T06:59:00Z"))).toBe("2026-06-30"); // 11:59 PM PDT
      expect(todayISO(new Date("2026-07-01T07:00:00Z"))).toBe("2026-07-01"); // midnight PDT
    });

    it("follows Pacific standard time, not UTC", () => {
      expect(todayISO(new Date("2026-12-01T07:59:00Z"))).toBe("2026-11-30"); // 11:59 PM PST
      expect(todayISO(new Date("2026-12-01T08:00:00Z"))).toBe("2026-12-01"); // midnight PST
    });
  });
});

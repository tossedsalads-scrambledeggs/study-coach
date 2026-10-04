import { describe, expect, it } from "vitest";
import { ERROR_TYPES, type ErrorType } from "@/lib/contracts";
import { addDays, currentUnit, needsMethodLine, redrillDate, redrillDays, todayISO } from "@/lib/rules";

/** The pure rules the error coach relies on (PLAN sections 1 and 4). */

describe("redrillDate: a problem from the current unit returns in 2 days, an earlier unit in 7", () => {
  it("same unit as the student is on -> today + 2 days", () => {
    expect(redrillDays(3, 3)).toBe(2);
    expect(redrillDate("2026-10-04", 3, 3)).toBe("2026-10-06");
  });

  it("any earlier unit -> today + 7 days", () => {
    expect(redrillDays(3, 2)).toBe(7);
    expect(redrillDays(5, 1)).toBe(7);
    expect(redrillDate("2026-10-04", 3, 2)).toBe("2026-10-11");
    expect(redrillDate("2026-10-04", 5, 1)).toBe("2026-10-11");
  });

  it("rolls over month, year and leap-day boundaries", () => {
    expect(redrillDate("2026-10-30", 2, 2)).toBe("2026-11-01");
    expect(redrillDate("2026-12-30", 4, 1)).toBe("2027-01-06");
    expect(redrillDate("2028-02-27", 2, 2)).toBe("2028-02-29");
    expect(redrillDate("2028-02-28", 2, 1)).toBe("2028-03-06");
  });

  it("a failed re-drill gets its new date by the same rule (re-using the rule gives the same answer)", () => {
    expect(redrillDate("2026-10-06", 3, 3)).toBe("2026-10-08");
    expect(redrillDate("2026-10-11", 3, 2)).toBe("2026-10-18");
  });
});

describe("addDays", () => {
  it("adds calendar days to an ISO date", () => {
    expect(addDays("2026-10-04", 0)).toBe("2026-10-04");
    expect(addDays("2026-10-04", 2)).toBe("2026-10-06");
    expect(addDays("2026-10-04", 7)).toBe("2026-10-11");
    expect(addDays("2026-10-04", -4)).toBe("2026-09-30");
  });
});

describe("needsMethodLine: every error except a pure computational slip adds a method line", () => {
  it("is false for a pure computational slip", () => {
    expect(needsMethodLine(["computational_slip"])).toBe(false);
  });

  it("is false for a repeated computational slip and for no types at all", () => {
    expect(needsMethodLine(["computational_slip", "computational_slip"])).toBe(false);
    expect(needsMethodLine([])).toBe(false);
  });

  it.each(ERROR_TYPES.filter((t) => t !== "computational_slip"))("is true for %s on its own", (type) => {
    expect(needsMethodLine([type])).toBe(true);
  });

  it("is true when a computational slip comes with any other type", () => {
    const others: ErrorType[] = ["concept_gap", "wrong_tool", "misread_setup"];
    for (const other of others) {
      expect(needsMethodLine(["computational_slip", other])).toBe(true);
      expect(needsMethodLine([other, "computational_slip"])).toBe(true);
    }
  });
});

describe("currentUnit: latest unit that has started, unless the student set an override", () => {
  const units = [
    { number: 1, startDate: "2026-09-01" },
    { number: 2, startDate: "2026-09-22" },
    { number: 3, startDate: "2026-10-13" },
  ];

  it("picks the latest unit whose start date has passed", () => {
    expect(currentUnit(units, "2026-09-10", null)).toBe(1);
    expect(currentUnit(units, "2026-09-22", null)).toBe(2);
    expect(currentUnit(units, "2026-10-04", null)).toBe(2);
    expect(currentUnit(units, "2026-12-01", null)).toBe(3);
  });

  it("is unit 1 before the course starts", () => {
    expect(currentUnit(units, "2026-08-01", null)).toBe(1);
  });

  it("a manual override always wins", () => {
    expect(currentUnit(units, "2026-12-01", 1)).toBe(1);
    expect(currentUnit(units, "2026-08-01", 3)).toBe(3);
  });

  it("ignores units that have no start date", () => {
    expect(currentUnit([{ number: 1, startDate: "2026-09-01" }, { number: 2, startDate: null }], "2026-10-04", null)).toBe(1);
  });
});

describe("todayISO", () => {
  it("formats a date as YYYY-MM-DD", () => {
    expect(todayISO(new Date("2026-10-04T20:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

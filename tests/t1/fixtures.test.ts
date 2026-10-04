import { describe, expect, it } from "vitest";
import { cleanPlan, expectPlanInvariants, makeDraft, makeUnits, messyPlan } from "./fixtures";

// Guards against vacuous tests: the "messy" model answer must really break the invariants and the "clean" one
// must really satisfy them, otherwise the planner tests could pass for the wrong reason.
describe("T1 test fixtures", () => {
  it("messyPlan breaks the plan invariants, so the planner has something to fix", () => {
    expect(() => expectPlanInvariants(messyPlan())).toThrow();
  });

  it("messyPlan has the specific flaws the planner tests rely on", () => {
    const plan = messyPlan();
    expect(plan.units.map((u) => u.number)).toEqual([3, 4, 5]);
    expect(plan.units.map((u) => u.difficulty)).toEqual([3, 7, 0]);
    expect(plan.units.map((u) => u.estHours)).toEqual([12, 0, null]);
    expect(plan.weeks.map((w) => w.weekNumber)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(plan.weeks.map((w) => w.unitNumber)).toEqual([3, 3, 4, 4, 5, 5]);
  });

  it("cleanPlan satisfies the plan invariants", () => {
    expect(() => expectPlanInvariants(cleanPlan())).not.toThrow();
  });

  it("makeUnits and makeDraft produce well-formed data", () => {
    expect(makeUnits().map((u) => u.number)).toEqual([1, 2, 3]);
    const draft = makeDraft(2, "Lec 6", "tag");
    expect(draft.unitNumber).toBe(2);
    for (const text of [draft.trigger, draft.move, draft.trap])
      expect(text.trim().length).toBeGreaterThan(0);
  });
});

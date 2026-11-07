import { describe, expect, it } from "vitest";
import { allocateRepayment } from "./repayment.ts";

const debts = [{ id: "a", outstanding: 3000 }, { id: "b", outstanding: 5000 }, { id: "c", outstanding: 2000 }];

describe("repayment is shared over the debts, oldest first", () => {
  it("pays the oldest debt fully, then part of the next", () => {
    expect(allocateRepayment(debts, 4000)).toEqual({ allocations: [{ id: "a", amount: 3000 }, { id: "b", amount: 1000 }], leftover: 0 });
  });
  it("pays everything when the amount equals all the debts", () => {
    const r = allocateRepayment(debts, 10000);
    expect(r.allocations.map((x) => x.amount)).toEqual([3000, 5000, 2000]);
    expect(r.leftover).toBe(0);
  });
  it("reports what is left over when more than the debts is typed", () => {
    expect(allocateRepayment(debts, 12000).leftover).toBe(2000);
  });
  it("gives nothing for a zero amount", () => {
    expect(allocateRepayment(debts, 0)).toEqual({ allocations: [], leftover: 0 });
  });
});

import { describe, expect, it } from "vitest";
import { dayEndRows } from "./day-end.ts";

describe("day-end summary", () => {
  it("sales 10,000 = cash 5,000 + bank 3,000 + mobile 1,000 + debt 1,000; debt is not taken from cash", () => {
    const r = dayEndRows([{ method: "Cash", amount: 5000 }, { method: "Bank", amount: 3000 }, { method: "M-Pesa", amount: 1000 }], 10000, 1000);
    expect(r.methods).toEqual([["Cash", 5000], ["Bank", 3000], ["M-Pesa", 1000]]);
    expect(r.received).toBe(9000);
    expect(r.difference).toBe(0);
  });
  it("adds up several receipts of the same method", () => {
    const r = dayEndRows([{ method: "Cash", amount: 2500.5 }, { method: "Cash", amount: 2499.5 }], 5000, 0);
    expect(r.methods).toEqual([["Cash", 5000]]);
  });
});

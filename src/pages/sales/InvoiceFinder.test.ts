import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CANCEL_REASONS, editedTotals } from "./invoice-finder-helpers.ts";

describe("InvoiceFinder helpers", () => {
  it("calculates the corrected totals like the server (line discount, invoice discount, tax)", () => {
    expect(editedTotals([{ qty: "2", price: "100", discount: "0" }], "0", "0")).toEqual({ subtotal: 200, discount: 0, tax: 0, total: 200 });
    expect(editedTotals([{ qty: "1", price: "150", discount: "0" }, { qty: "2", price: "100", discount: "50" }], "0", "0").total).toBe(300);
    expect(editedTotals([{ qty: "3", price: "100", discount: "0" }], "30", "18")).toEqual({ subtotal: 300, discount: 30, tax: 48.6, total: 318.6 });
    expect(editedTotals([], "0", "0").total).toBe(0);
    expect(editedTotals([{ qty: "x", price: "100", discount: "0" }], "", "")).toEqual({ subtotal: 0, discount: 0, tax: 0, total: 0 });
  });

  it("offers exactly the cancellation reasons the server accepts", () => {
    const server = readFileSync("convex/sales.ts", "utf8");
    for (const reason of CANCEL_REASONS) expect(server, reason).toContain(`"${reason}"`);
    expect(CANCEL_REASONS).toHaveLength(6);
  });
});

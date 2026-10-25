import { describe, expect, it } from "vitest";
import { allocateSettlement } from "./settlement";

const inv = [{ id: "a", invoiceNo: "INV-1", outstanding: 10000 }, { id: "b", invoiceNo: "INV-2", outstanding: 6000 }];

describe("allocateSettlement", () => {
  it("splits cash + mobile money over invoices oldest first and totals match", () => {
    const r = allocateSettlement(inv, [{ method: "cash", amount: 12000 }, { method: "mobile", amount: 3000 }]);
    expect(r.map((x) => x.total)).toEqual([10000, 5000]);
    expect(r[0].splits).toEqual([{ method: "cash", methodId: undefined, amount: 10000, reference: undefined }]);
    expect(r[1].splits.map((s) => [s.method, s.amount])).toEqual([["cash", 2000], ["mobile", 3000]]);
    expect(r.reduce((s, x) => s + x.total, 0)).toBe(15000);
  });
  it("partial payment leaves the later invoice untouched", () => {
    const r = allocateSettlement(inv, [{ method: "cash", amount: 4000 }]);
    expect(r).toHaveLength(1);
    expect(r[0].invoiceId).toBe("a");
    expect(r[0].total).toBe(4000);
  });
  it("rejects overpayment and empty payment", () => {
    expect(() => allocateSettlement(inv, [{ method: "cash", amount: 16000.01 }])).toThrow();
    expect(() => allocateSettlement(inv, [{ method: "cash", amount: 0 }])).toThrow();
  });
  it("never reuses one reference twice when a payment is shared by two invoices", () => {
    const r = allocateSettlement(inv, [{ method: "bank", amount: 16000, reference: "TX9" }]);
    const refs = r.flatMap((x) => x.splits.map((s) => s.reference));
    expect(new Set(refs).size).toBe(refs.length);
  });
  it("handles cents without drift", () => {
    const r = allocateSettlement([{ id: "a", invoiceNo: "I", outstanding: 0.3 }], [{ method: "cash", amount: 0.1 }, { method: "bank", amount: 0.2 }]);
    expect(r[0].total).toBe(0.3);
  });
});

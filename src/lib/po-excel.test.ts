import { describe, expect, it } from "vitest";
import { poRows, type PoSheet } from "./po-excel.ts";

const order: PoSheet = {
  orderRef: "PO-1-ABC", orderDate: "2026-11-07", expectedDelivery: "2026-11-10", status: "approved", notes: "Tuletee asubuhi", total: 7000,
  supplier: { name: "Kiwanda A", phone: "0700", address: "" },
  lines: [
    { itemCode: "B1", productName: "Bia", unit: "Crate", qtyOrdered: 2, unitCost: 2000, lineTotal: 4000 },
    { itemCode: "S1", productName: "Soda", unit: "Crate", qtyOrdered: 3, unitCost: 1000, lineTotal: 3000 },
  ],
};

describe("Purchase Order excel rows", () => {
  it("has the business, the order details, one row per line and the total", () => {
    const rows = poRows("Bar ya Juma", order);
    expect(rows[0]).toEqual(["Bar ya Juma"]);
    expect(rows[1]).toEqual(["PURCHASE ORDER", "PO-1-ABC"]);
    expect(rows.find((r) => r[0] === "Supplier")).toEqual(["Supplier", "Kiwanda A"]);
    expect(rows.find((r) => r[0] === "Address")).toEqual(["Address", "-"]);
    expect(rows.filter((r) => typeof r[0] === "number")).toHaveLength(2);
    expect(rows.find((r) => r[5] === "TOTAL")?.[6]).toBe(7000);
    expect(rows[rows.length - 1]).toEqual(["Notes", "Tuletee asubuhi"]);
  });
});

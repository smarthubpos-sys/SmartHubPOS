import { describe, expect, it } from "vitest";
import { emptyServicePoint, filterProducts, formatServicePoint, pickWalkInClient, servicePointHasKind, servicePointLabel } from "./sales-flow.ts";

describe("service point (floor / table / room) is optional", () => {
  it("is empty by default and formats to nothing", () => {
    expect(formatServicePoint(emptyServicePoint())).toBe("");
    expect(formatServicePoint({ kind: "room", floor: " ", name: "  " })).toBe("");
  });

  it("keeps a plain table number exactly as before", () => {
    expect(formatServicePoint({ kind: "table", floor: "", name: " 5 " })).toBe("5");
    expect(servicePointLabel("5")).toBe("Meza 5");
  });

  it("describes tables on a floor and rooms", () => {
    expect(formatServicePoint({ kind: "table", floor: "2", name: "5" })).toBe("Ghorofa 2 · Meza 5");
    expect(formatServicePoint({ kind: "room", floor: "", name: "105" })).toBe("Chumba 105");
    expect(formatServicePoint({ kind: "room", floor: "1", name: "105" })).toBe("Ghorofa 1 · Chumba 105");
    expect(formatServicePoint({ kind: "table", floor: "3", name: "" })).toBe("Ghorofa 3");
  });

  it("can be written in English", () => {
    const en = { table: "Table", room: "Room", floor: "Floor" };
    expect(formatServicePoint({ kind: "room", floor: "1", name: "105" }, en)).toBe("Floor 1 · Room 105");
  });

  it("never doubles the kind word when showing a stored value", () => {
    expect(servicePointLabel("Chumba 105")).toBe("Chumba 105");
    expect(servicePointLabel("Ghorofa 2 · Meza 5")).toBe("Ghorofa 2 · Meza 5");
    expect(servicePointLabel("Meza 7")).toBe("Meza 7");
    expect(servicePointLabel("Table 3", "Table")).toBe("Table 3");
    expect(servicePointLabel("12A")).toBe("Meza 12A");
    expect(servicePointLabel("")).toBe("");
    expect(servicePointLabel(undefined)).toBe("");
    expect(servicePointHasKind("Chumba 105")).toBe(true);
    expect(servicePointHasKind("5")).toBe(false);
  });
});

describe("product picker filters are optional", () => {
  const products = [
    { _id: "1", name: "Cement 50kg", itemCode: "CEM-50", barcode: "111", groupId: "g1" },
    { _id: "2", name: "Nails 4in", itemCode: "NAL-4", barcode: undefined, groupId: undefined },
    { _id: "3", name: "Beer Safari", itemCode: "BR-1", barcode: "222", groupId: "g2" },
  ];

  it("shows every product when no group and no search are chosen (a business without groups)", () => {
    expect(filterProducts(products, {})).toHaveLength(3);
    expect(filterProducts(products, { groupId: "all", query: "  " })).toHaveLength(3);
  });

  it("filters by group, by text, and by both", () => {
    expect(filterProducts(products, { groupId: "g2" }).map((p) => p._id)).toEqual(["3"]);
    expect(filterProducts(products, { query: "NAIL" }).map((p) => p._id)).toEqual(["2"]);
    expect(filterProducts(products, { query: "cem-50" }).map((p) => p._id)).toEqual(["1"]);
    expect(filterProducts(products, { query: "222" }).map((p) => p._id)).toEqual(["3"]);
    expect(filterProducts(products, { groupId: "g1", query: "beer" })).toEqual([]);
  });
});

describe("walk-in customer", () => {
  it("pre-selects the single active Cash / Walk-in customer", () => {
    expect(pickWalkInClient([{ _id: "a", name: "Juma Hardware" }, { _id: "b", name: "Cash Customer" }])).toBe("b");
    expect(pickWalkInClient([{ _id: "a", name: "Mteja wa kawaida" }])).toBe("a");
    expect(pickWalkInClient([{ _id: "a", name: "Walk-in" }])).toBe("a");
  });

  it("does not guess when there is none, several, or only an inactive one", () => {
    expect(pickWalkInClient([])).toBe("");
    expect(pickWalkInClient([{ _id: "a", name: "Juma" }])).toBe("");
    expect(pickWalkInClient([{ _id: "a", name: "Cash A" }, { _id: "b", name: "Cash B" }])).toBe("");
    expect(pickWalkInClient([{ _id: "a", name: "Cash Customer", isActive: false }])).toBe("");
  });
});

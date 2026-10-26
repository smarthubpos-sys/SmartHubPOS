import { describe, expect, it } from "vitest";
import { ALL_PERMISSION_KEYS, PERMISSION_BUNDLES, togglePermission } from "./permissions";

describe("choosing a module brings all of its reports", () => {
  it("every bundled key exists in the permission catalog", () => {
    for (const [main, linked] of Object.entries(PERMISSION_BUNDLES)) {
      expect(ALL_PERMISSION_KEYS).toContain(main);
      for (const k of linked) expect(ALL_PERMISSION_KEYS).toContain(k);
    }
  });

  it("Sales, Stock and Purchasing each bring their reports", () => {
    expect(togglePermission([], "sales.view").sort()).toEqual(["sales.reports.view", "sales.view"]);
    expect(togglePermission([], "stock.view").sort()).toEqual(["stock.reports.view", "stock.view"]);
    expect(togglePermission([], "purchasing.view").sort()).toEqual(["purchasing.reports.view", "purchasing.view"]);
  });

  it("removing the module removes its reports, but a report can be removed alone", () => {
    expect(togglePermission(["sales.view", "sales.reports.view", "sales.print"], "sales.view")).toEqual(["sales.print"]);
    expect(togglePermission(["sales.view", "sales.reports.view"], "sales.reports.view")).toEqual(["sales.view"]);
  });

  it("other permissions are untouched and never duplicated", () => {
    expect(togglePermission(["sales.reports.view"], "sales.view").sort()).toEqual(["sales.reports.view", "sales.view"]);
    expect(togglePermission(["sales.view"], "sales.print").sort()).toEqual(["sales.print", "sales.view"]);
  });
});

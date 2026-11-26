import { describe, expect, it } from "vitest";
import { productMatches } from "./product-search.ts";

describe("item search on purchase screens", () => {
  const bia = { name: "Safari Lager 500ml", itemCode: "BR-001" };
  it("shows everything when nothing is typed", () => {
    expect(productMatches(bia, "")).toBe(true);
    expect(productMatches(bia, "   ")).toBe(true);
    expect(productMatches(undefined, "")).toBe(true);
  });
  it("finds by part of the name, any case, any word order", () => {
    expect(productMatches(bia, "lager")).toBe(true);
    expect(productMatches(bia, "500ML safari")).toBe(true);
  });
  it("finds by item code", () => { expect(productMatches(bia, "br-0")).toBe(true); });
  it("hides items that do not match every word", () => {
    expect(productMatches(bia, "safari wine")).toBe(false);
    expect(productMatches(undefined, "safari")).toBe(false);
  });
});

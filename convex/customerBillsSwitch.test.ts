import { describe, expect, it } from "vitest";
import { customerBillsEnabledFor } from "./customerBillsSwitch.ts";

describe("customer bills switch", () => {
  it("is ON for a business saved before the switch existed", () => {
    expect(customerBillsEnabledFor(undefined)).toBe(true);
    expect(customerBillsEnabledFor(null)).toBe(true);
    expect(customerBillsEnabledFor({})).toBe(true);
  });
  it("follows the saved value", () => {
    expect(customerBillsEnabledFor({ customerBillsEnabled: true })).toBe(true);
    expect(customerBillsEnabledFor({ customerBillsEnabled: false })).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { whatsappOrderText, whatsappPhone, whatsappUrl } from "@/lib/whatsapp.ts";

describe("whatsapp helpers", () => {
  it("normalises Tanzanian numbers", () => {
    expect(whatsappPhone("0712 345 678")).toBe("255712345678");
    expect(whatsappPhone("+255712345678")).toBe("255712345678");
    expect(whatsappPhone("00255712345678")).toBe("255712345678");
  });
  it("rejects empty or too-short numbers", () => {
    expect(whatsappPhone("")).toBe("");
    expect(whatsappPhone(undefined)).toBe("");
    expect(whatsappPhone("12-3")).toBe("");
  });
  it("builds the message and link", () => {
    const text = whatsappOrderText({ companyName: "Duka", customerName: "Asha", tableNumber: "T3", total: 7000, lines: [{ name: "Soda", qty: 2, lineTotal: 2000 }, { name: "Chips", qty: 1, lineTotal: 5000 }] });
    expect(text).toContain("Soda × 2 = 2,000/=");
    expect(text).toContain("JUMLA: 7,000/=");
    expect(text).toContain("Meza: T3");
    expect(whatsappUrl("255712345678", "a b")).toBe("https://wa.me/255712345678?text=a%20b");
  });
});

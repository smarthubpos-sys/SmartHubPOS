import { describe, expect, it } from "vitest";
import { COMPLETE_DICT } from "./i18n-dict-complete.ts";
import { getLang, setLang, tr, trMessage } from "./i18n.ts";

const placeholders = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join(",");

describe("complete dictionary (English mode shows English everywhere)", () => {
  it("has Kiswahili and English text with matching placeholders for every entry", () => {
    for (const [key, v] of Object.entries(COMPLETE_DICT)) {
      expect(v.sw, key).toBeTruthy();
      expect(v.en, key).toBeTruthy();
      expect(placeholders(v.en), key).toBe(placeholders(key));
    }
  });

  it("switches invoice, payment and report texts with the saved language", () => {
    expect(getLang()).toBe("sw");
    setLang("en", { reload: false });
    expect(tr("RISITI YA MALIPO")).toBe("PAYMENT RECEIPT");
    expect(tr("Benki: {0}", ["CRDB"])).toBe("Bank: CRDB");
    expect(trMessage("Malipo ya awali ya invoice")).toBe("Advance payment of the invoice");
    expect(trMessage("Bidhaa haipo")).toBe("The product does not exist");
    setLang("sw", { reload: false });
    expect(tr("RISITI YA MALIPO")).toBe("RISITI YA MALIPO");
    expect(tr("Benki: {0}", ["CRDB"])).toBe("Benki: CRDB");
  });
});

import { describe, expect, it } from "vitest";
import { DICT } from "./i18n-dict.ts";
import { SERVER_DICT } from "./i18n-server-dict.ts";
import { EXTRA_DICT } from "./i18n-dict-subscriptions.ts";
import { ACCESS_DICT } from "./i18n-dict-access.ts";
import { SUPERADMIN_DICT, INVOICING_DICT, DEPT_DICT } from "./i18n-dict-superadmin.ts";
import { PREPORT_DICT } from "./i18n-dict-preports.ts";
import { IMPORT_DICT } from "./i18n-dict-import.ts";
import { tr, trMessage, trValue, errorText, getLang, setLang } from "./i18n.ts";

const placeholders = (s: string) => (s.match(/\{\d+\}/g) ?? []).sort().join(",");

describe("single-language dictionary", () => {
  it("knows every errorText fallback message used in the app", () => {
    const fallbacks = ["Imeshindikana kuhifadhi taarifa.", "Imeshindikana kuingia.", "Hitilafu imetokea.", "Imeshindikana kusoma faili.", "Imeshindikana kuingiza bidhaa."];
    for (const f of fallbacks) expect(DICT[f], f).toBeTruthy();
  });

  it("has a Kiswahili and an English text for every entry, with matching placeholders", () => {
    for (const [key, v] of [...Object.entries(DICT), ...Object.entries(SERVER_DICT), ...Object.entries(EXTRA_DICT), ...Object.entries(ACCESS_DICT), ...Object.entries(SUPERADMIN_DICT), ...Object.entries(INVOICING_DICT), ...Object.entries(DEPT_DICT), ...Object.entries(PREPORT_DICT), ...Object.entries(IMPORT_DICT)]) {
      expect(v.sw, key).toBeTruthy();
      expect(v.en, key).toBeTruthy();
      expect(placeholders(v.sw), key).toBe(placeholders(key));
      expect(placeholders(v.en), key).toBe(placeholders(key));
    }
  });

  it("translates into the system language only (Kiswahili default) and fills placeholders", () => {
    expect(getLang()).toBe("sw");
    expect(tr("Save")).toBe("Save"); // unknown key is returned unchanged
    expect(tr("Dashboard")).toBe("Dashibodi");
    expect(tr("Hifadhi")).toBe("Hifadhi");
    expect(tr("Invoice {0} imehifadhiwa — jumla {1}, deni {2}.", ["A1", 10, 2])).toBe("Invoice A1 imehifadhiwa — jumla 10, deni 2.");
    expect(trValue("posted")).toBe("Imepostiwa");
    setLang("en", { reload: false });
    expect(tr("Dashboard")).toBe("Dashboard");
    expect(tr("Hifadhi")).toBe("Save");
    expect(tr("Invoice {0} imehifadhiwa — jumla {1}, deni {2}.", ["A1", 10, 2])).toBe("Invoice A1 saved — total 10, outstanding 2.");
    expect(trValue("cash")).toBe("Cash");
    setLang("sw", { reload: false });
  });

  it("translates backend errors, including ones with dynamic parts, and strips the Convex wrapper", () => {
    setLang("en", { reload: false });
    expect(trMessage("Mteja hayupo kwenye branch yako.")).toBe("The customer is not in your branch.");
    expect(trMessage("Stock haitoshi kwa Sukari. Iliyopo: 2, unayouza: 5")).toBe("Not enough stock for Sukari. Available: 2, selling: 5");
    const wrapped = new Error("[CONVEX M(sales:create)] [Request ID: x] Server Error Uncaught Error: Bei ya kuuzia si sahihi.\n    at handler (../convex/sales.ts:1:1)");
    expect(errorText(wrapped, "Hitilafu imetokea.")).toBe("The selling price is not valid.");
    setLang("sw", { reload: false });
  });
});

import { describe, expect, it } from "vitest";
import { DICT } from "./i18n-dict.ts";
import { SERVER_DICT } from "./i18n-server-dict.ts";
import { EXTRA_DICT } from "./i18n-dict-subscriptions.ts";
import { ACCESS_DICT } from "./i18n-dict-access.ts";
import { SUPERADMIN_DICT, INVOICING_DICT, DEPT_DICT } from "./i18n-dict-superadmin.ts";
import { PREPORT_DICT } from "./i18n-dict-preports.ts";
import { IMPORT_DICT } from "./i18n-dict-import.ts";
import { FRIENDLY_DICT } from "./i18n-dict-friendly.ts";
import { tr, trMessage, trValue, errorText, errorKind, getLang, setLang } from "./i18n.ts";

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

  it("tells the person when the server does not have the function the screen calls (stale deployment), instead of a vague fallback", () => {
    const stale = new Error("[CONVEX Q(waiterOrders:listForBills)] [Request ID: x] Server Error Could not find public function for 'waiterOrders:listForBills'. Did you forget to run `npx convex dev` or `npx convex deploy`?");
    expect(errorText(stale, "Imeshindikana kuchakata oda.")).toContain("waiterOrders:listForBills");
    expect(errorText(stale, "Imeshindikana kuchakata oda.")).toMatch(/haijasasishwa/);
    setLang("en", { reload: false });
    expect(errorText(stale, "x")).toBe("The server is not up to date: function 'waiterOrders:listForBills' does not exist on this system. Contact your system administrator.");
    setLang("sw", { reload: false });
  });
});

describe("friendly permission and mistake messages", () => {
  // What a ConvexError looks like on the screen: the text sits in `data` (a plain Error would only say "Server Error" in production).
  const denied = (text: string) => Object.assign(new Error("[CONVEX M(x)] [Request ID: y] Server Error"), { data: text });

  it("keeps a matching Kiswahili and English text, with the same placeholders, for every friendly entry", () => {
    for (const [key, v] of Object.entries(FRIENDLY_DICT)) {
      expect(v.sw, key).toBeTruthy();
      expect(v.en, key).toBeTruthy();
      expect(placeholders(v.sw), key).toBe(placeholders(key));
      expect(placeholders(v.en), key).toBe(placeholders(key));
    }
  });

  it("says plainly that the person has no permission (and what to do), in the system language, not as a system fault", () => {
    const e = denied("Forbidden: manager permission required");
    expect(errorKind(e)).toBe("permission");
    expect(errorText(e, "Imeshindikana kuhifadhi taarifa.")).toBe("Huna ruhusa ya kufanya kitendo hiki; ni meneja pekee anayeweza. Muombe meneja au msimamizi akupe ruhusa.");
    setLang("en", { reload: false });
    expect(errorText(e, "Imeshindikana kuhifadhi taarifa.")).toBe("You do not have permission to do this; only a manager can. Ask a manager or administrator to give you permission.");
    setLang("sw", { reload: false });
  });

  it("names the missing permission so the administrator knows what to grant", () => {
    const e = denied('Forbidden: permission "stock.adjust" required');
    expect(errorKind(e)).toBe("permission");
    expect(errorText(e)).toContain("stock.adjust");
    expect(errorText(e)).toMatch(/^Huna ruhusa/);
    setLang("en", { reload: false });
    expect(errorText(e)).toMatch(/^You do not have permission/);
    setLang("sw", { reload: false });
  });

  it("treats an ended session as a sign-in problem, and a mistake as neither", () => {
    expect(errorKind(denied("Unauthenticated"))).toBe("signin");
    expect(errorText(denied("Unauthenticated"))).toMatch(/Ingia tena/);
    expect(errorKind(denied("Weka jina la mteja."))).toBeNull();
    expect(errorKind(new Error("Cannot read properties of undefined"))).toBeNull();
  });

  it("tells a person who made a mistake what is wrong and what to do, in English when English is the system language", () => {
    setLang("en", { reload: false });
    expect(errorText(denied("Weka jina la mteja."))).toBe("Enter the customer's name.");
    expect(errorText(denied("Stock haitoshi kwa Bia. Iliyopo: 2, inahitajika: 5."))).toBe("Not enough stock for Bia. Available: 2, needed: 5. Reduce the quantity or receive more stock.");
    expect(errorText(denied("Mteja amefikia kikomo cha mkopo. Deni la mteja lingekuwa 900, kikomo cha mkopo ni 500. Lipa sehemu ya deni kwanza."))).toBe("The customer has reached the credit limit. The customer's debt would be 900, the credit limit is 500. Pay part of the debt first.");
    expect(errorText(denied("Kipindi cha hesabu \"Oktoba\" kimefungwa (2026-10-01 hadi 2026-10-31); huwezi kuweka miamala ya tarehe 2026-10-15. Mwombe meneja afungue kipindi kwanza."))).toMatch(/^The accounting period "Oktoba" is closed/);
    setLang("sw", { reload: false });
  });

  it("only a real unexpected fault falls back to the generic message, which still says what to do", () => {
    const hidden = new Error("[CONVEX M(x)] [Request ID: y] Server Error");
    expect(errorKind(hidden)).toBeNull();
    expect(errorText(hidden, "Imeshindikana kuhifadhi taarifa.")).toMatch(/jaribu tena/i);
  });
});

import { tr } from "./i18n.ts";
import { formatDate, formatNumber } from "./format.ts";

type P = Record<string, string | number>;
const d = (v: string | number) => formatDate(String(v));

/** Turns a backend alert (code + params) into text in the system language. */
export function notificationText(code: string, p: P): { title: string; body: string } {
  switch (code) {
    case "out_of_stock": return { title: tr("Bidhaa imeisha: {0}", [p.name]), body: tr("Stoo ni sifuri. Agiza au pokea bidhaa.") };
    case "low_stock": return { title: tr("Bidhaa inaisha: {0}", [p.name]), body: tr("Imebaki {0}, kiwango cha kuagiza ni {1}.", [p.qty, p.level]) };
    case "bill_overdue": return { title: tr("Bili imechelewa: {0}", [p.vendor]), body: tr("Bili {0}, deni {1}, ilitakiwa kulipwa {2}.", [p.bill, formatNumber(Number(p.amount)), d(p.due)]) };
    case "bill_due_soon": return { title: tr("Bili inakaribia kulipwa: {0}", [p.vendor]), body: tr("Bili {0}, deni {1}, tarehe ya mwisho {2}.", [p.bill, formatNumber(Number(p.amount)), d(p.due)]) };
    case "leave_pending": return { title: tr("Ombi la likizo: {0}", [p.name]), body: tr("Kuanzia {0} hadi {1} linasubiri idhini.", [d(p.from), d(p.to)]) };
    case "payroll_draft": return { title: tr("Mishahara inasubiri idhini: {0}", [p.name]), body: tr("Idhinisha ili iingie kwenye hesabu.") };
    case "ticket_open": return { title: tr("Ombi la msaada: {0}", [p.subject]), body: tr("Kutoka kwa {0}.", [p.name]) };
    case "ticket_replied": return { title: tr("Jibu la msaada: {0}", [p.subject]), body: tr("Timu ya msaada imejibu ombi lako.") };
    case "announcement": return { title: String(p.title), body: String(p.body) };
    case "demo_expiring": return { title: Number(p.days) === 0 ? tr("Demo inaisha leo") : tr("Demo inaisha baada ya siku {0}", [Number(p.days)]), body: tr("Mwisho wa matumizi ni {0}. Wasiliana na SmartHub ulipie ili uendelee.", [d(p.date)]) };
    case "sub_expiring": return { title: Number(p.days) === 0 ? tr("Usajili unaisha leo") : tr("Usajili unaisha baada ya siku {0}", [Number(p.days)]), body: tr("Mwisho wa matumizi ni {0}. Lipia mapema ili mfumo usikatike.", [d(p.date)]) };
    default: return { title: code, body: "" };
  }
}

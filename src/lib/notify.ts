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
    case "leave_pending_late": return { title: tr("Ombi la likizo (limechelewa): {0}", [p.name]), body: tr("Kuanzia {0} hadi {1}. Limetumwa baada ya ruhusa kuanza; linasubiri uamuzi.", [d(p.from), d(p.to)]) };
    case "leave_approved": return { title: tr("Ombi lako la likizo limekubaliwa"), body: tr("Kuanzia {0} hadi {1}. {2}", [d(p.from), d(p.to), p.note]) };
    case "leave_rejected": return { title: tr("Ombi lako la likizo limekataliwa"), body: tr("Kuanzia {0} hadi {1}. Sababu: {2}", [d(p.from), d(p.to), p.note]) };
    case "payroll_draft": return { title: tr("Mishahara inasubiri idhini: {0}", [p.name]), body: tr("Idhinisha ili iingie kwenye hesabu.") };
    case "staff_late": return { title: tr("{0} amechelewa kazini dakika {1}", [p.name, p.minutes]), body: tr("Alitakiwa {0}, aliingia {1}. Atakatwa {2}.", [p.start, p.time, formatNumber(Number(p.amount))]) };
    case "staff_not_in": return { title: tr("{0} hajaingia kazini bado", [p.name]), body: tr("Alitakiwa kuingia {0}. Asipoingia leo, mshahara wa siku nzima ({1}) utakatwa.", [p.start, formatNumber(Number(p.amount))]) };
    case "staff_absent": return { title: tr("{0} hakuingia kazini {1}", [p.name, d(p.date)]), body: tr("Mshahara wa siku nzima ({0}) utakatwa. Kama alikuwa na ruhusa, mwekee likizo kwenye HR.", [formatNumber(Number(p.amount))]) };
    case "ticket_open": return { title: tr("Ombi la msaada: {0}", [p.subject]), body: tr("Kutoka kwa {0}.", [p.name]) };
    case "ticket_replied": return { title: tr("Jibu la msaada: {0}", [p.subject]), body: tr("Timu ya msaada imejibu ombi lako.") };
    case "waiter_order_received": return { title: tr("Oda yako imechapishwa na Cashier."), body: tr("Oda ya {0}, meza {1}, imechapishwa na kupokelewa.", [p.customer, p.table]) };
    case "announcement": return { title: String(p.title), body: String(p.body) };
    case "demo_expiring": return { title: Number(p.days) === 0 ? tr("Demo inaisha leo") : tr("Demo inaisha baada ya siku {0}", [Number(p.days)]), body: tr("Mwisho wa matumizi ni {0}. Wasiliana na SmartHub ulipie ili uendelee.", [d(p.date)]) };
    case "sub_expiring": return { title: Number(p.days) === 0 ? tr("Usajili unaisha leo") : tr("Usajili unaisha baada ya siku {0}", [Number(p.days)]), body: tr("Mwisho wa matumizi ni {0}. Lipia mapema ili mfumo usikatike.", [d(p.date)]) };
    default: return { title: code, body: "" };
  }
}

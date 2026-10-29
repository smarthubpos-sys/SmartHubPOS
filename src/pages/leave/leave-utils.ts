import { getLocale, tr } from "@/lib/i18n.ts";

export const LEAVE_TYPES = ["annual", "sick", "maternity", "paternity", "unpaid", "other"];
export const leaveLabel = (k: string) => ({ annual: tr("Likizo ya mwaka"), sick: tr("Likizo ya ugonjwa"), maternity: tr("Likizo ya uzazi"), paternity: tr("Likizo ya baba"), unpaid: tr("Likizo bila malipo"), other: tr("Nyingine") } as Record<string, string>)[k] ?? k;
export const targetLabel = (t: string | null) => (t === "hr" ? tr("HR") : t === "manager" ? tr("Manager") : tr("Imeingizwa na HR"));

export type LeaveRow = {
  _id: string; employeeName: string; employeeCode: string; position?: string; department?: string; leaveType: string; startDate: string; endDate: string; days: number;
  reason?: string; status: string; stage: string; target: "manager" | "hr" | null; lateRequest: boolean; requestedAt: string; receivedAt?: string; viewedAt?: string;
  viewedByName?: string; decidedAt?: string; decidedByName?: string; decisionNote?: string; clashes: number;
};

/** Date and time in the business time zone (East Africa Time), whatever the device's own zone is. */
export function formatStamp(iso?: string) {
  if (!iso) return "";
  return new Date(iso).toLocaleString(getLocale(), { timeZone: "Africa/Dar_es_Salaam", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false });
}

export const stageTone = (s: string) => (s === "approved" ? "green" : s === "rejected" ? "rose" : s === "cancelled" ? "gray" : s === "viewed" || s === "received" ? "blue" : "amber") as "green" | "rose" | "gray" | "blue" | "amber";
export const stageLabel = (s: string) => ({ sent: tr("Imetumwa"), received: tr("Imepokelewa"), viewed: tr("Imeonwa"), approved: tr("Imekubaliwa"), rejected: tr("Imekataliwa"), cancelled: tr("Imeghairiwa") } as Record<string, string>)[s] ?? s;


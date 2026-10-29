/** Pure rules for self-service leave / permission requests (no database access, so they are easy to test). */

export type LeaveStage = "sent" | "received" | "viewed" | "approved" | "rejected" | "cancelled";

/**
 * A request is "late" when it is sent after the leave has already begun:
 * the start date is in the past, or it is today and the person's working day has already started.
 * `dueStartMinutes` = start of today's shift in minutes since midnight (undefined = no timetable that day).
 */
export function isLateRequest(startDate: string, now: { date: string; minutes: number }, dueStartMinutes?: number): boolean {
  if (startDate < now.date) return true;
  return startDate === now.date && dueStartMinutes !== undefined && now.minutes >= dueStartMinutes;
}

/** Where a request is on its way: sent -> received (receiver's screen loaded it) -> viewed (opened) -> approved / rejected. */
export function stageOf(row: { status: string; receivedAt?: string; viewedAt?: string }): LeaveStage {
  if (row.status === "approved" || row.status === "rejected" || row.status === "cancelled") return row.status;
  if (row.viewedAt) return "viewed";
  if (row.receivedAt) return "received";
  return "sent";
}

export const dayCount = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000) + 1;

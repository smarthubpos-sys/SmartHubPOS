import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// 01:07 East Africa time (22:07 UTC, not on the hour so it does not queue with other jobs): re-check the exact dashboard totals of every business used in the last 3 days.
crons.daily("reconcile dashboard stats", { hourUTC: 22, minuteUTC: 7 }, internal.stats.reconcileAll);

// 08:00 East Africa time (05:00 UTC): remind businesses by e-mail that their subscription / demo ends in 7, 3, 1 day(s) or today.
crons.daily("subscription reminders", { hourUTC: 5, minuteUTC: 11 }, internal.subscriptionReminders.sendDue);

export default crons;

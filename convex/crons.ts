import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// 01:07 East Africa time (22:07 UTC, not on the hour so it does not queue with other jobs): re-check the exact dashboard totals of every business used in the last 3 days.
crons.daily("reconcile dashboard stats", { hourUTC: 22, minuteUTC: 7 }, internal.stats.reconcileAll);

export default crons;

import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// 01:00 East Africa time (22:00 UTC): re-check the exact dashboard totals of every business used in the last 3 days.
crons.daily("reconcile dashboard stats", { hourUTC: 22, minuteUTC: 0 }, internal.stats.reconcileAll);

export default crons;

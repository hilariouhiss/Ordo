import limits from "./limits.json";

/** Limits both the core and the interface enforce; the Rust side reads the same file. */
export const EFFORT_MAX_MINUTES = limits.effortMinutes;
export const STATS_RANGE_DAYS = limits.statsRangeDays;
export const REMINDER_LEAD_MAX_MINUTES = limits.reminderLeadMinutes;

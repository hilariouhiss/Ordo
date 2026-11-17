import { nextWorkday, workdayOnOrAfter } from "./timing";

export interface PlanTask {
  id: string;
  effortMinutes: number;
  expectedFinishDate: string | null;
  /** The task's own start date; missing or in the past falls back to the plan start. */
  expectedStartDate?: string | null;
}

export interface PlannedTask {
  id: string;
  start: string;
  end: string;
  /** The hour of the working day the task starts in: 0–7. */
  startHour: number;
  conflict: boolean;
}

/** An eight-hour working day; effort is minutes and the planner books whole hours. */
const HOURS_PER_DAY = 8;

const MINUTES_PER_HOUR = 60;

/** More than two person-days (16 hours) of work on one working day is worth a warning. */
export const LOAD_WARN_HOURS = 16;

interface Start {
  day: string;
  hour: number;
}

function needOf(task: PlanTask): number {
  const minutes = Number.isFinite(task.effortMinutes) ? task.effortMinutes : 0;
  return Math.max(1, Math.ceil(minutes / MINUTES_PER_HOUR));
}

/** Where the plan begins: the task's own start date (never before the week), else today. */
function anchorOf(task: PlanTask, start: string, weekStart: string): string {
  const explicit = task.expectedStartDate;
  return workdayOnOrAfter(explicit ? (explicit > weekStart ? explicit : weekStart) : start);
}

/** The next hourly slot: the next hour, then the next working day's first hour. */
function slotAfter(day: string, hour: number): Start {
  return hour < HOURS_PER_DAY - 1 ? { day, hour: hour + 1 } : { day: nextWorkday(day), hour: 0 };
}

/** The last day a task of `need` hours reaches when it starts at `start`. */
function endOf(start: Start, need: number): string {
  let slot = start;
  for (let left = need - 1; left > 0; left--) slot = slotAfter(slot.day, slot.hour);
  return slot.day;
}

/**
 * Starts every task on its own start date, at the first hour of the day. Nothing is
 * booked, so tasks overlap freely and a day carries whatever work the week puts on it.
 *
 * A due date only counts while the plan can still reach it. Once it is in the past the
 * row is late, not unplannable: the inequality would stay true however the plan moved,
 * and the row already says how many days overdue it is.
 */
export function planSchedule(
  tasks: PlanTask[],
  start: string,
  weekStart: string = start,
): PlannedTask[] {
  return tasks.map((task) => {
    const day = anchorOf(task, start, weekStart);
    const end = endOf({ day, hour: 0 }, needOf(task));
    return {
      id: task.id,
      start: day,
      end,
      startHour: 0,
      conflict:
        task.expectedFinishDate !== null &&
        task.expectedFinishDate >= start &&
        end > task.expectedFinishDate,
    };
  });
}

export interface PlannedDayPart {
  day: string;
  hours: number;
}

/** The working days a planned row occupies, with the hours booked on each. */
export function plannedDayParts(task: PlanTask, row: PlannedTask): PlannedDayPart[] {
  const parts: PlannedDayPart[] = [];
  let day = row.start;
  let hour = row.startHour;
  let left = needOf(task);

  while (left > 0) {
    const booked = Math.min(left, HOURS_PER_DAY - hour);
    parts.push({ day, hours: booked });
    left -= booked;
    if (left > 0) {
      day = nextWorkday(day);
      hour = 0;
    }
  }
  return parts;
}

/** Hours booked on each working day, summed over every planned task. */
export function planLoads(tasks: PlanTask[], plan: PlannedTask[]): Map<string, number> {
  const rows = new Map(plan.map((row) => [row.id, row]));
  const loads = new Map<string, number>();

  for (const task of tasks) {
    const row = rows.get(task.id);
    if (!row) continue;
    for (const part of plannedDayParts(task, row)) {
      loads.set(part.day, (loads.get(part.day) ?? 0) + part.hours);
    }
  }
  return loads;
}

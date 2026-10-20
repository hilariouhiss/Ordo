import { addDays, isWeekend } from "./dates";

export interface PlanTask {
  id: string;
  effortDays: number;
  dueDate: string | null;
}

export interface PlannedTask {
  id: string;
  start: string;
  end: string;
  conflict: boolean;
}

/** One working day holds two half-day units; every task takes at least one. */
const HALF_DAYS_PER_DAY = 2;

function nextWorkday(iso: string): string {
  let day = addDays(iso, 1);
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}

function startWorkday(iso: string): string {
  let day = iso;
  while (isWeekend(day)) day = addDays(day, 1);
  return day;
}

/** Packs tasks back to back on working days, in the order given. */
export function planSchedule(tasks: PlanTask[], start: string): PlannedTask[] {
  let cursor = startWorkday(start);
  let remaining = HALF_DAYS_PER_DAY;
  const plan: PlannedTask[] = [];

  for (const task of tasks) {
    const days = Number.isFinite(task.effortDays) ? task.effortDays : 0;
    let need = Math.max(1, Math.round(days * 2));
    if (remaining === 0) {
      cursor = nextWorkday(cursor);
      remaining = HALF_DAYS_PER_DAY;
    }
    const plannedStart = cursor;
    while (need > 0) {
      const take = Math.min(need, remaining);
      need -= take;
      remaining -= take;
      if (need > 0) {
        cursor = nextWorkday(cursor);
        remaining = HALF_DAYS_PER_DAY;
      }
    }
    plan.push({
      id: task.id,
      start: plannedStart,
      end: cursor,
      conflict: task.dueDate !== null && cursor > task.dueDate,
    });
  }
  return plan;
}

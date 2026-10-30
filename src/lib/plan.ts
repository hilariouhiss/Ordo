import type { Task } from "../model/types";
import { weekdayLabel } from "./dates";
import type { PlanTask, PlannedTask } from "./schedule";

export interface PlannedRow {
  task: Task;
  end: string;
  spans: boolean;
  conflict: boolean;
}

export interface PlannedDay {
  date: string;
  weekday: string;
  isToday: boolean;
  rows: PlannedRow[];
}

export function toPlanTask(task: Task): PlanTask {
  return {
    id: task.id,
    effortMinutes: task.effortMinutes,
    expectedFinishDate: task.expectedFinishDate,
    expectedStartDate: task.expectedStartDate,
    exclusive: task.exclusive,
  };
}

/** Groups a list by the day the planner starts it; order inside a day is kept. */
export function groupPlannedDays(tasks: Task[], plan: PlannedTask[], today: string): PlannedDay[] {
  const planned = new Map(plan.map((row) => [row.id, row]));
  const groups = new Map<string, PlannedDay>();
  for (const task of tasks) {
    const row = planned.get(task.id);
    if (!row) continue;
    let group = groups.get(row.start);
    if (!group) {
      group = {
        date: row.start,
        weekday: weekdayLabel(row.start),
        isToday: row.start === today,
        rows: [],
      };
      groups.set(row.start, group);
    }
    group.rows.push({
      task,
      end: row.end,
      spans: row.end !== row.start,
      conflict: row.conflict,
    });
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Adds an empty group for every listed date the planner left without work. A day counts
 * as busy when any planned task starts on it or spans across it, so a filled day never
 * shows up twice and a multi-day task does not look like a gap.
 */
export function fillPlannedDays(
  days: PlannedDay[],
  dates: string[],
  plan: PlannedTask[],
  today: string,
): PlannedDay[] {
  const groups = new Map(days.map((day) => [day.date, day]));
  for (const date of dates) {
    if (groups.has(date)) continue;
    const busy = plan.some((row) => row.start <= date && date <= row.end);
    if (busy) continue;
    groups.set(date, { date, weekday: weekdayLabel(date), isToday: date === today, rows: [] });
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

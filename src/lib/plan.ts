import type { Task } from "../model/types";
import { weekdayLabel } from "./dates";
import { plannedDayParts, type PlanTask, type PlannedTask } from "./schedule";

export interface PlannedRow {
  task: Task;
  end: string;
  spans: boolean;
  /** Working days the task covers; 1 for a single-day task. */
  days: number;
  conflict: boolean;
}

/** A later day of a multi-day task: the full card stays on the start day. */
export interface PlannedSpan {
  task: Task;
  end: string;
  /** Which day of the span this is; 2 is the first continuation. */
  day: number;
  total: number;
  hours: number;
}

export interface PlannedDay {
  date: string;
  weekday: string;
  isToday: boolean;
  rows: PlannedRow[];
  spans: PlannedSpan[];
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

function plannedDay(date: string, today: string): PlannedDay {
  return { date, weekday: weekdayLabel(date), isToday: date === today, rows: [], spans: [] };
}

/** Groups a list by the day the planner starts it; later days of a span get continuation entries. */
export function groupPlannedDays(tasks: Task[], plan: PlannedTask[], today: string): PlannedDay[] {
  const planned = new Map(plan.map((row) => [row.id, row]));
  const planTasks = new Map(tasks.map((task) => [task.id, toPlanTask(task)]));
  const groups = new Map<string, PlannedDay>();
  const groupFor = (date: string): PlannedDay => {
    let group = groups.get(date);
    if (!group) {
      group = plannedDay(date, today);
      groups.set(date, group);
    }
    return group;
  };

  for (const task of tasks) {
    const row = planned.get(task.id);
    const planTask = planTasks.get(task.id);
    if (!row || !planTask) continue;
    const parts = plannedDayParts(planTask, row);
    groupFor(row.start).rows.push({
      task,
      end: row.end,
      spans: parts.length > 1,
      days: parts.length,
      conflict: row.conflict,
    });
    for (let index = 1; index < parts.length; index++) {
      const part = parts[index];
      groupFor(part.day).spans.push({
        task,
        end: row.end,
        day: index + 1,
        total: parts.length,
        hours: part.hours,
      });
    }
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
    groups.set(date, plannedDay(date, today));
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

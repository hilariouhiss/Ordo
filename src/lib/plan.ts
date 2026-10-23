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
    effortDays: task.effortDays,
    dueDate: task.dueDate,
    startDate: task.startDate,
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

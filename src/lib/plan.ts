import type { Task } from "../model/types";
import { localDate, weekdayLabel } from "./dates";
import { plannedDayParts, type PlanTask, type PlannedTask } from "./schedule";

export interface PlannedRow {
  task: Task;
  /** The day the planner starts the task; later than the group when the row is clamped. */
  start: string;
  end: string;
  spans: boolean;
  /** Working days the task covers; 1 for a single-day task. */
  days: number;
  /** The plan starts after `weekEnd`, so the row sits on that last day instead. */
  clamped: boolean;
  conflict: boolean;
  /** Already finished: shown for the record, not draggable. */
  history?: boolean;
}

/** A later day of a multi-day task: the full card stays on the start day. */
export interface PlannedSpan {
  task: Task;
  end: string;
  /** Which day of the span this is; 2 is the first continuation. */
  day: number;
  total: number;
  hours: number;
  /** Effort-minute offset where this day starts, clamped to the task's effort. */
  from: number;
  to: number;
}

export interface PlannedDay {
  date: string;
  weekday: string;
  isToday: boolean;
  isPast: boolean;
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
  return {
    date,
    weekday: weekdayLabel(date),
    isToday: date === today,
    isPast: date < today,
    rows: [],
    spans: [],
  };
}

/**
 * Groups a list by the day the planner starts it; later days of a span get continuation
 * entries. `weekEnd` cuts the list at this week's last workday: a task the plan starts
 * later is clamped onto that day so it stays visible and can still be completed.
 */
export function groupPlannedDays(
  tasks: Task[],
  plan: PlannedTask[],
  today: string,
  weekEnd?: string,
): PlannedDay[] {
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
    const day = weekEnd !== undefined && row.start > weekEnd ? weekEnd : row.start;
    groupFor(day).rows.push({
      task,
      start: row.start,
      end: row.end,
      spans: parts.length > 1,
      days: parts.length,
      clamped: day !== row.start,
      conflict: row.conflict,
    });
    // Offsets are in effort minutes, not booked hours: the planner rounds the last
    // day up to a whole hour, while the steps only cover the real estimate.
    let offset = parts[0].hours * 60;
    for (let index = 1; index < parts.length; index++) {
      const part = parts[index];
      if (weekEnd !== undefined && part.day > weekEnd) break;
      groupFor(part.day).spans.push({
        task,
        end: row.end,
        day: index + 1,
        total: parts.length,
        hours: part.hours,
        from: Math.min(offset, task.effortMinutes),
        to: Math.min(offset + part.hours * 60, task.effortMinutes),
      });
      offset += part.hours * 60;
    }
  }

  // A clamped row starts later than its day, so it reads after the day's own work.
  for (const group of groups.values()) group.rows.sort((a, b) => a.start.localeCompare(b.start));
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

/**
 * Puts finished tasks back on the day they were done — or, when that day is outside the
 * week, on the day they were planned for — so a past day still shows its work.
 */
export function addDoneRows(
  days: PlannedDay[],
  done: Task[],
  dates: string[],
  today: string,
): PlannedDay[] {
  const groups = new Map(days.map((day) => [day.date, day]));
  for (const task of done) {
    const finished = task.actualFinishAt ? localDate(task.actualFinishAt) : null;
    const planned = task.expectedStartDate;
    const date =
      finished && dates.includes(finished)
        ? finished
        : planned && dates.includes(planned)
          ? planned
          : null;
    if (!date) continue;
    let group = groups.get(date);
    if (!group) {
      group = plannedDay(date, today);
      groups.set(date, group);
    }
    group.rows.push({
      task,
      start: date,
      end: date,
      spans: false,
      days: 1,
      clamped: false,
      conflict: false,
      history: true,
    });
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

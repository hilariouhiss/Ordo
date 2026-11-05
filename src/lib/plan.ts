import type { Task } from "../model/types";
import { localDate, weekdayLabel } from "./dates";
import { plannedDayParts, type PlanTask, type PlannedTask, type PlannedDayPart } from "./schedule";

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

/** One task as the gantt draws it: a bar across the columns it covers. */
export interface WeekLane {
  task: Task;
  row: PlannedRow;
  /** 0-based column of the first and last week workday the bar covers. */
  from: number;
  to: number;
}

export interface PlannedDay {
  date: string;
  weekday: string;
  isToday: boolean;
  isPast: boolean;
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

function plannedDay(date: string, today: string): PlannedDay {
  return {
    date,
    weekday: weekdayLabel(date),
    isToday: date === today,
    isPast: date < today,
    rows: [],
  };
}

/** The row a task shows on any day of its plan; every covered day gets the same one. */
function rowOf(task: Task, row: PlannedTask, parts: PlannedDayPart[], day: string): PlannedRow {
  return {
    task,
    start: row.start,
    end: row.end,
    spans: parts.length > 1,
    days: parts.length,
    clamped: day !== row.start,
    conflict: row.conflict,
  };
}

/**
 * Groups a list by the day the planner starts it. With `repeatSpans` (the week page) the
 * task also lands on every later working day it covers; the desktop widget passes false
 * because it has room for one card per task. `weekEnd` cuts the list at this week's last
 * workday: a task the plan starts later is clamped onto that day so it stays visible and
 * can still be completed.
 */
export function groupPlannedDays(
  tasks: Task[],
  plan: PlannedTask[],
  today: string,
  weekEnd?: string,
  repeatSpans = true,
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
    const entry = rowOf(task, row, parts, day);
    groupFor(day).rows.push(entry);
    if (!repeatSpans) continue;
    for (const part of parts.slice(1)) {
      if (weekEnd !== undefined && part.day > weekEnd) break;
      groupFor(part.day).rows.push(entry);
    }
  }

  // A clamped row starts later than its day, so it reads after the day's own work.
  for (const group of groups.values()) group.rows.sort((a, b) => a.start.localeCompare(b.start));
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * Folds the planned days back into one gantt lane per task: the columns it covers and the
 * row it reads with. Manual order decides the lane order, finished ones included, so a
 * done task stays where it was instead of moving to a separate group.
 */
export function groupLanes(days: PlannedDay[], dates: string[]): WeekLane[] {
  const lanes = new Map<string, WeekLane>();
  for (const day of days) {
    const column = dates.indexOf(day.date);
    if (column < 0) continue;
    for (const row of day.rows) {
      const lane = lanes.get(row.task.id);
      if (!lane) {
        lanes.set(row.task.id, { task: row.task, row, from: column, to: column });
        continue;
      }
      lane.from = Math.min(lane.from, column);
      lane.to = Math.max(lane.to, column);
    }
  }
  return [...lanes.values()].sort(
    (a, b) => a.task.sortOrder - b.task.sortOrder || a.task.id.localeCompare(b.task.id),
  );
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
 * Puts finished tasks back on the days they were planned for — or, when the plan has no
 * day in this week, on the day they were done — so a past day still shows its work. A
 * multi-day task keeps every day it covered; without a planned day there is no span to
 * restore and the record stays on the finish day.
 */
export function addDoneRows(
  days: PlannedDay[],
  done: Task[],
  dates: string[],
  today: string,
): PlannedDay[] {
  const groups = new Map(days.map((day) => [day.date, day]));
  const weekEnd = dates[dates.length - 1];
  const groupFor = (date: string): PlannedDay => {
    let group = groups.get(date);
    if (!group) {
      group = plannedDay(date, today);
      groups.set(date, group);
    }
    return group;
  };

  for (const task of done) {
    const finished = task.actualFinishAt ? localDate(task.actualFinishAt) : null;
    const planned = task.expectedStartDate;
    // A plan that starts after the finish would put a finished task in the future.
    const start =
      planned && dates.includes(planned) && !(finished !== null && finished < planned)
        ? planned
        : finished !== null && dates.includes(finished)
          ? finished
          : null;
    if (!start) continue;
    const parts =
      start === planned
        ? plannedDayParts(toPlanTask(task), {
            id: task.id,
            start,
            end: start,
            startHour: 0,
            conflict: false,
          })
        : [{ day: start }];
    const end = parts[parts.length - 1].day;
    const row: PlannedRow = {
      task,
      start,
      end,
      spans: parts.length > 1,
      days: parts.length,
      clamped: false,
      conflict: false,
      history: true,
    };
    groupFor(start).rows.push(row);
    for (const part of parts.slice(1)) {
      if (weekEnd !== undefined && part.day > weekEnd) break;
      groupFor(part.day).rows.push(row);
    }
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

import type { Task } from "../model/types";
import { addDays, isWeekend, localDate, weekdayLabel } from "./dates";
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
  /** Parked: shown where it was planned, but it books no hours. */
  parked?: boolean;
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

/** One task as the gantt draws it: a bar across the columns it covers, on one row. */
export interface WeekLane {
  task: Task;
  row: PlannedRow;
  /** 0-based column of the first and last week workday the bar covers. */
  from: number;
  to: number;
  /** 0-based row it reads on; two bars may share one when their days do not overlap. */
  rowIndex: number;
}

interface LaneBar {
  task: Task;
  row: PlannedRow;
  from: number;
  to: number;
}

/**
 * Folds the planned days back into one lane per task: the columns it covers and the row
 * it reads on. A bar that spans days keeps one row for its whole span and claims it
 * first; a bar that lives on a single day drops into the lowest row its own day leaves
 * free, so work from another day never holds a row above it. Finished and parked work
 * keeps its place instead of moving to a separate group.
 */
export function groupLanes(days: PlannedDay[], dates: string[]): WeekLane[] {
  const bars: LaneBar[] = [];
  const byTask = new Map<string, LaneBar>();
  for (const day of days) {
    const column = dates.indexOf(day.date);
    if (column < 0) continue;
    for (const row of day.rows) {
      const bar = byTask.get(row.task.id);
      if (!bar) {
        const fresh: LaneBar = { task: row.task, row, from: column, to: column };
        byTask.set(row.task.id, fresh);
        bars.push(fresh);
        continue;
      }
      bar.from = Math.min(bar.from, column);
      bar.to = Math.max(bar.to, column);
    }
  }

  // Rows are booked per column: a bar may share a row with one that lives on other days.
  const booked = new Map<number, number>();
  const firstFreeRow = (from: number, to: number): number => {
    for (let row = 0; ; row++) {
      let free = true;
      for (let column = from; column <= to; column++) {
        if (((booked.get(row) ?? 0) & (1 << column)) !== 0) {
          free = false;
          break;
        }
      }
      if (free) return row;
    }
  };
  const book = (row: number, from: number, to: number): void => {
    let columns = booked.get(row) ?? 0;
    for (let column = from; column <= to; column++) columns |= 1 << column;
    booked.set(row, columns);
  };

  const order = (a: LaneBar, b: LaneBar): number =>
    a.from - b.from || a.task.sortOrder - b.task.sortOrder || a.task.id.localeCompare(b.task.id);
  const spanning = bars.filter((bar) => bar.to > bar.from).sort(order);
  const single = bars.filter((bar) => bar.to === bar.from).sort(order);

  const lanes: WeekLane[] = [];
  for (const bar of [...spanning, ...single]) {
    const rowIndex = firstFreeRow(bar.from, bar.to);
    book(rowIndex, bar.from, bar.to);
    lanes.push({ ...bar, rowIndex });
  }
  // Reading order, so tabbing walks the grid row by row.
  return lanes.sort(
    (a, b) => a.rowIndex - b.rowIndex || a.from - b.from || a.task.sortOrder - b.task.sortOrder,
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

/** The workdays a finished task really ran, or null when either actual stamp is missing. */
function actualWorkdays(task: Task): string[] | null {
  if (!task.actualStartAt || !task.actualFinishAt) return null;
  const start = localDate(task.actualStartAt);
  const finish = localDate(task.actualFinishAt);
  if (finish < start) return null;
  const days: string[] = [];
  for (let day = start; day <= finish; day = addDays(day, 1)) {
    if (!isWeekend(day)) days.push(day);
  }
  return days.length ? days : null;
}

/**
 * Puts finished tasks back where they really ran: actual start through actual finish,
 * workdays only, clipped to this week. Without both actual stamps it falls back to the
 * days they were planned for — or, when the plan has no day in this week, to the day
 * they were done — so a past day still shows its work.
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
    // A finished task with real times reads as it happened, not as it was estimated.
    const actual = actualWorkdays(task);
    const shown = actual?.filter((day) => dates.includes(day)) ?? [];
    if (actual && shown.length) {
      const row: PlannedRow = {
        task,
        start: actual[0],
        end: actual[actual.length - 1],
        spans: actual.length > 1,
        days: actual.length,
        clamped: false,
        conflict: false,
        history: true,
      };
      for (const day of shown) groupFor(day).rows.push(row);
      continue;
    }
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

/**
 * Puts parked tasks back on the day their plan would have started, in their hand order
 * among that day's work. Parked rows book no hours; the week's own plan and its numbers
 * stay as they are.
 */
export function addParkedRows(
  days: PlannedDay[],
  parked: Task[],
  plan: PlannedTask[],
  dates: string[],
  today: string,
): PlannedDay[] {
  const rows = new Map(plan.map((row) => [row.id, row]));
  const groups = new Map(days.map((day) => [day.date, day]));
  const weekEnd = dates[dates.length - 1];
  const touched = new Set<PlannedDay>();

  for (const task of parked) {
    const row = rows.get(task.id);
    if (!row) continue;
    const day = row.start > weekEnd ? weekEnd : row.start;
    if (!dates.includes(day)) continue;
    let group = groups.get(day);
    if (!group) {
      group = plannedDay(day, today);
      groups.set(day, group);
    }
    group.rows.push({
      task,
      start: row.start,
      end: row.end,
      // One card on one day: the days it would need are not this week's plan.
      spans: false,
      days: 1,
      clamped: day !== row.start,
      conflict: false,
      parked: true,
    });
    touched.add(group);
  }

  // Within a day: finished work last, then by start, then the manual order that ties them.
  const order = (one: PlannedRow, other: PlannedRow): number =>
    Number(!!one.history) - Number(!!other.history) ||
    one.start.localeCompare(other.start) ||
    one.task.sortOrder - other.task.sortOrder ||
    one.task.id.localeCompare(other.task.id);
  for (const group of touched) group.rows.sort(order);

  return [...groups.values()].sort((one, other) => one.date.localeCompare(other.date));
}

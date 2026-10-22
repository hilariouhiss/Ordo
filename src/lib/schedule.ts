import { addDays, isWeekend } from "./dates";

export interface PlanTask {
  id: string;
  effortDays: number;
  dueDate: string | null;
  /** The task's own start date; missing or in the past falls back to the plan start. */
  startDate?: string | null;
  /** Exclusive tasks own their whole planned span; nothing else may overlap it. */
  exclusive?: boolean;
}

export interface PlannedTask {
  id: string;
  start: string;
  end: string;
  conflict: boolean;
}

export interface ExclusiveConflict {
  /** The exclusive task already sitting on the new task's natural span. */
  taskId: string;
  start: string;
  end: string;
  /** Where the new task actually starts once it is pushed clear. */
  plannedStart: string;
}

/** One working day holds two half-day units; every task takes at least one. */
const HALF_DAYS_PER_DAY = 2;

/** More than two person-days of shared work on one working day is worth a warning. */
export const LOAD_WARN_HALF_DAYS = 4;

interface Span {
  start: string;
  end: string;
}

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

function needOf(task: PlanTask): number {
  const days = Number.isFinite(task.effortDays) ? task.effortDays : 0;
  return Math.max(1, Math.round(days * 2));
}

function anchorOf(task: PlanTask, start: string): string {
  return startWorkday(task.startDate && task.startDate > start ? task.startDate : start);
}

function spanEnd(start: string, need: number): string {
  let day = start;
  let left = need;
  while (left > HALF_DAYS_PER_DAY) {
    left -= HALF_DAYS_PER_DAY;
    day = nextWorkday(day);
  }
  return day;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start <= b.end && a.end >= b.start;
}

/** The first free working day after an exclusive span, or the anchor if it is clear. */
function placeClear(anchor: string, need: number, blocked: Span[]): Span {
  let start = anchor;
  for (;;) {
    const end = spanEnd(start, need);
    const hit = blocked.find((span) => overlaps({ start, end }, span));
    if (!hit) return { start, end };
    start = nextWorkday(hit.end);
  }
}

/**
 * Places exclusive tasks first and shared tasks around them. Shared tasks never
 * block each other; exclusive tasks are days nothing else may enter.
 */
export function planSchedule(tasks: PlanTask[], start: string): PlannedTask[] {
  const planned = new Map<string, Span>();
  const blocked: Span[] = [];

  for (const task of tasks) {
    if (!task.exclusive) continue;
    const span = placeClear(anchorOf(task, start), needOf(task), blocked);
    blocked.push(span);
    planned.set(task.id, span);
  }
  for (const task of tasks) {
    if (task.exclusive) continue;
    planned.set(task.id, placeClear(anchorOf(task, start), needOf(task), blocked));
  }

  return tasks.map((task) => {
    const span = planned.get(task.id) as Span;
    return {
      id: task.id,
      start: span.start,
      end: span.end,
      conflict: task.dueDate !== null && span.end > task.dueDate,
    };
  });
}

/** Half-day units booked on each working day, summed over every planned task. */
export function planLoads(tasks: PlanTask[], plan: PlannedTask[]): Map<string, number> {
  const starts = new Map(plan.map((row) => [row.id, row.start]));
  const loads = new Map<string, number>();

  for (const task of tasks) {
    let day = starts.get(task.id);
    if (!day) continue;
    let left = needOf(task);
    while (left > 0) {
      const take = Math.min(left, HALF_DAYS_PER_DAY);
      loads.set(day, (loads.get(day) ?? 0) + take);
      left -= take;
      if (left > 0) day = nextWorkday(day);
    }
  }
  return loads;
}

/** The first exclusive task whose planned span covers the new task's natural span. */
export function exclusiveConflict(
  task: PlanTask,
  tasks: PlanTask[],
  start: string,
): ExclusiveConflict | null {
  const naturalStart = anchorOf(task, start);
  const naturalEnd = spanEnd(naturalStart, needOf(task));
  const plan = planSchedule(tasks, start);
  const exclusiveIds = new Set(tasks.filter((one) => one.exclusive).map((one) => one.id));
  const plannedStart = plan.find((row) => row.id === task.id)?.start ?? naturalStart;

  for (const row of plan) {
    if (row.id === task.id || !exclusiveIds.has(row.id)) continue;
    if (naturalStart <= row.end && naturalEnd >= row.start) {
      return { taskId: row.id, start: row.start, end: row.end, plannedStart };
    }
  }
  return null;
}

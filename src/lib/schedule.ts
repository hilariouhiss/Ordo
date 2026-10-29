import { addDays, isWeekend } from "./dates";

export interface PlanTask {
  id: string;
  effortMinutes: number;
  dueDate: string | null;
  /** The task's own start date; missing or in the past falls back to the plan start. */
  startDate?: string | null;
  /** Exclusive tasks reserve only the hours they need; nothing else may use them. */
  exclusive?: boolean;
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
  const minutes = Number.isFinite(task.effortMinutes) ? task.effortMinutes : 0;
  return Math.max(1, Math.ceil(minutes / MINUTES_PER_HOUR));
}

function anchorOf(task: PlanTask, start: string): string {
  return startWorkday(task.startDate && task.startDate > start ? task.startDate : start);
}

/** The next hourly slot: the next hour, then the next working day's first hour. */
function slotAfter(day: string, hour: number): Start {
  return hour < HOURS_PER_DAY - 1 ? { day, hour: hour + 1 } : { day: nextWorkday(day), hour: 0 };
}

/** A working day has eight hourly slots; the bits mark the ones already taken. */
function isFree(taken: Map<string, number>, day: string, hour: number): boolean {
  return ((taken.get(day) ?? 0) & (1 << hour)) === 0;
}

function fits(taken: Map<string, number>, start: Start, need: number): boolean {
  let slot = start;
  for (let left = need; left > 0; left--) {
    if (!isFree(taken, slot.day, slot.hour)) return false;
    if (left > 1) slot = slotAfter(slot.day, slot.hour);
  }
  return true;
}

/** The first working hour at or after the anchor with `need` free slots in a row. */
function firstFree(anchor: string, need: number, taken: Map<string, number>): Start {
  let slot: Start = { day: startWorkday(anchor), hour: 0 };
  for (;;) {
    if (fits(taken, slot, need)) return slot;
    slot = slotAfter(slot.day, slot.hour);
  }
}

function reserve(taken: Map<string, number>, start: Start, need: number): void {
  let slot = start;
  for (let left = need; left > 0; left--) {
    taken.set(slot.day, (taken.get(slot.day) ?? 0) | (1 << slot.hour));
    if (left > 1) slot = slotAfter(slot.day, slot.hour);
  }
}

function endOf(start: Start, need: number): string {
  let slot = start;
  for (let left = need - 1; left > 0; left--) slot = slotAfter(slot.day, slot.hour);
  return slot.day;
}

/**
 * Places exclusive tasks first and shared tasks around them. Exclusive tasks take
 * only the hours their effort needs, so other work can fill the rest of the day;
 * shared tasks never block each other. An explicit start date is honored before
 * the manual queue.
 */
export function planSchedule(tasks: PlanTask[], start: string): PlannedTask[] {
  const planned = new Map<string, { slot: Start; end: string }>();
  const taken = new Map<string, number>();
  const pinned = tasks
    .filter((task) => task.exclusive && task.startDate && task.startDate >= start)
    .sort((a, b) => (a.startDate as string).localeCompare(b.startDate as string));
  const queued = tasks.filter(
    (task) => task.exclusive && !(task.startDate && task.startDate >= start),
  );

  for (const task of [...pinned, ...queued]) {
    const need = needOf(task);
    const slot = firstFree(anchorOf(task, start), need, taken);
    reserve(taken, slot, need);
    planned.set(task.id, { slot, end: endOf(slot, need) });
  }
  for (const task of tasks) {
    if (task.exclusive) continue;
    const need = needOf(task);
    const slot = firstFree(anchorOf(task, start), need, taken);
    planned.set(task.id, { slot, end: endOf(slot, need) });
  }

  return tasks.map((task) => {
    const row = planned.get(task.id) as { slot: Start; end: string };
    return {
      id: task.id,
      start: row.slot.day,
      end: row.end,
      startHour: row.slot.hour,
      conflict: task.dueDate !== null && row.end > task.dueDate,
    };
  });
}

/** Hours booked on each working day, summed over every planned task. */
export function planLoads(tasks: PlanTask[], plan: PlannedTask[]): Map<string, number> {
  const rows = new Map(plan.map((row) => [row.id, row]));
  const loads = new Map<string, number>();

  for (const task of tasks) {
    const row = rows.get(task.id);
    if (!row) continue;
    let day = row.start;
    let hour = row.startHour;
    let left = needOf(task);
    while (left > 0) {
      const booked = Math.min(left, HOURS_PER_DAY - hour);
      loads.set(day, (loads.get(day) ?? 0) + booked);
      left -= booked;
      if (left > 0) {
        day = nextWorkday(day);
        hour = 0;
      }
    }
  }
  return loads;
}

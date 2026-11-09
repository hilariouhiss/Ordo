/** Where a drop lands in the week list: a day block and the row it reads above. */
export interface ListDrop {
  day: string;
  beforeId: string | null;
}

/** Where a drop lands in the gantt: a column index and the lane it reads above. */
export interface GanttDrop {
  column: number;
  before: string | null;
}

/**
 * The day block under a viewport y, and the first row whose midpoint the pointer has not
 * passed. Shared by the list rows and the bottom stack, which both drop onto days.
 */
export function listDropAt(listEl: HTMLElement | null | undefined, y: number): ListDrop | null {
  const sections = listEl?.querySelectorAll<HTMLElement>("[data-day]");
  if (!sections?.length) return null;
  let section: HTMLElement | null = null;
  for (const candidate of sections) {
    if (y < candidate.getBoundingClientRect().bottom) {
      section = candidate;
      break;
    }
  }
  const day = section?.dataset.day;
  if (!section || !day) return null;
  let beforeId: string | null = null;
  for (const row of section.querySelectorAll<HTMLElement>("[data-task-id]")) {
    const rect = row.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) {
      beforeId = row.dataset.taskId ?? null;
      break;
    }
  }
  return { day, beforeId };
}

/**
 * The gantt column under a viewport x, clamped to the shown dates, and the first lane
 * whose midpoint the pointer has not passed. The bottom stack drops through the same
 * math as the bars, so a card lands exactly where the bars do.
 */
export function ganttDropAt(
  gridEl: HTMLElement | null | undefined,
  x: number,
  y: number,
  columns: number,
): GanttDrop | null {
  if (!gridEl || columns < 1) return null;
  const box = gridEl.getBoundingClientRect();
  const width = box.width / columns;
  const column = Math.floor((x - box.left) / width);
  let before: string | null = null;
  for (const row of gridEl.querySelectorAll<HTMLElement>("[data-lane]")) {
    const rect = row.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) {
      before = row.dataset.lane ?? null;
      break;
    }
  }
  return { column: Math.min(columns - 1, Math.max(0, column)), before };
}

/**
 * The days each open task already shows on. Both the list and the board use it so a drop
 * inside a task's span only reorders it instead of moving its start day.
 */
export function coveredDays(
  days: { date: string; rows: { task: { id: string }; history?: boolean }[] }[],
): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const day of days) {
    for (const row of day.rows) {
      if (row.history) continue;
      const dates = map.get(row.task.id) ?? new Set<string>();
      dates.add(day.date);
      map.set(row.task.id, dates);
    }
  }
  return map;
}

/**
 * The global anchor for a day-local drop: the first task of a later day when the drop
 * lands after the day's last card, so a move leaves the task at the bottom of that day
 * instead of jumping past the other days. A multi-day task that started on an earlier
 * day is ordered before that day's own work, so it cannot serve as the anchor.
 */
export function anchorFor(
  days: { date: string; rows: { task: { id: string }; start: string; history?: boolean }[] }[],
  day: string,
  beforeId: string | null,
): string | null {
  if (beforeId) return beforeId;
  const index = days.findIndex((entry) => entry.date === day);
  for (const later of days.slice(index + 1)) {
    const first = later.rows.find((row) => !row.history && row.start === later.date);
    if (first) return first.task.id;
  }
  return null;
}

/** Where a drop lands in the week list: a day block and the row it reads above. */
export interface ListDrop {
  day: string;
  beforeId: string | null;
}

/** Where a drop lands on the week board: a day panel and the card it reads above. */
export interface BoardDrop {
  day: string;
  beforeId: string | null;
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

function dropInPanel(panel: HTMLElement, y: number): BoardDrop | null {
  const day = panel.dataset.day;
  if (!day) return null;
  let beforeId: string | null = null;
  for (const card of panel.querySelectorAll<HTMLElement>("[data-task-id]")) {
    const rect = card.getBoundingClientRect();
    if (y < rect.top + rect.height / 2) {
      beforeId = card.dataset.taskId ?? null;
      break;
    }
  }
  return { day, beforeId };
}

function holds(panel: HTMLElement, x: number, y: number): boolean {
  const rect = panel.getBoundingClientRect();
  return y >= rect.top && y < rect.bottom && x >= rect.left && x < rect.right;
}

/**
 * The day panel under a viewport point and the card it reads above. Panels overlap in
 * the past-day deck, so the last one in DOM order wins; `topDay` is the raised past-day
 * card the drag started from, which is drawn above the today column even though its
 * panel comes first in the DOM. A pointer in the gap between columns falls back to the
 * nearer one.
 */
export function boardDropAt(
  container: HTMLElement | null | undefined,
  x: number,
  y: number,
  topDay?: string | null,
): BoardDrop | null {
  const panels = [...(container?.querySelectorAll<HTMLElement>("[data-day]") ?? [])];
  if (!panels.length) return null;
  const open = topDay ?? container?.dataset.deckOpen ?? null;
  if (open) {
    const top = panels.find((panel) => panel.dataset.day === open);
    if (top && holds(top, x, y)) return dropInPanel(top, y);
  }
  let chosen: HTMLElement | null = null;
  let nearest: { panel: HTMLElement; gap: number } | null = null;
  for (const panel of panels) {
    const rect = panel.getBoundingClientRect();
    if (y < rect.top || y >= rect.bottom) continue;
    if (x >= rect.left && x < rect.right) {
      chosen = panel;
      continue;
    }
    const gap = x < rect.left ? rect.left - x : x - rect.right;
    if (!nearest || gap < nearest.gap) nearest = { panel, gap };
  }
  const panel = chosen ?? nearest?.panel;
  return panel ? dropInPanel(panel, y) : null;
}

/**
 * The global anchor for a day-local drop: the first live task of a later day when the
 * drop lands after the day's last card, so a move leaves the task at the bottom of that
 * day instead of jumping past the other days.
 */
export function anchorFor(
  days: { date: string; rows: { task: { id: string }; history?: boolean }[] }[],
  day: string,
  beforeId: string | null,
): string | null {
  if (beforeId) return beforeId;
  const index = days.findIndex((entry) => entry.date === day);
  for (const later of days.slice(index + 1)) {
    const first = later.rows.find((row) => !row.history);
    if (first) return first.task.id;
  }
  return null;
}

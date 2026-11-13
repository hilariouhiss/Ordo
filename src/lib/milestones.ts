import type { Milestone } from "../model/types";

/** The earliest open milestone that has a day: the one the project list names. */
export function nextMilestone(milestones: Milestone[]): Milestone | null {
  let next: Milestone | null = null;
  for (const milestone of milestones) {
    if (milestone.doneAt || !milestone.dueDate) continue;
    if (!next || milestone.dueDate < next.dueDate!) next = milestone;
  }
  return next;
}

/** Whether an open milestone's day has already passed. */
export function isMilestoneOverdue(milestone: Milestone, today: string): boolean {
  return !milestone.doneAt && milestone.dueDate !== null && milestone.dueDate < today;
}

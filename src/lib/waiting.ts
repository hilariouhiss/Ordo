import type { Person, Task } from "../model/types";
import { addDays } from "./dates";

export interface WaitingDefaults {
  personId: string | null;
  followUpDate: string;
}

/** The nudge the dialog opens with: three days is enough to hear back once. */
export function defaultFollowUp(today: string): string {
  return addDays(today, 3);
}

/**
 * What the waiting dialog starts with. An existing wait keeps the person it already
 * names and its day while that day is still ahead; otherwise the owner stands in for
 * the person when it is someone else, and the day falls back to the default.
 */
export function waitDefaults(task: Task, people: Person[], today: string): WaitingDefaults {
  const me = people.find((person) => person.isMe);
  const owner = task.ownerId && task.ownerId !== me?.id ? task.ownerId : null;
  const stored = task.waiting ? task.followUpDate : null;
  return {
    personId: task.waiting ? task.waitingOnId : owner,
    followUpDate: stored && stored >= today ? stored : defaultFollowUp(today),
  };
}

export function waitingOnName(task: Task, people: Person[]): string | null {
  return people.find((person) => person.id === task.waitingOnId)?.name ?? null;
}

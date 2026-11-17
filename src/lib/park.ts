import type { Person, Task } from "../model/types";
import { addDays } from "./dates";

export interface ParkDefaults {
  personId: string | null;
  until: string;
}

/** The day to look again the dialog opens with: three days is enough to hear back once. */
export function defaultReviewDay(today: string): string {
  return addDays(today, 3);
}

/**
 * What the park dialog starts with. An existing park keeps the person it names and its day
 * while that day is still ahead; otherwise the owner stands in for the person when it is
 * someone else, and the day falls back to the default.
 */
export function parkDefaults(task: Task, people: Person[], today: string): ParkDefaults {
  const me = people.find((person) => person.isMe);
  const owner = task.ownerId && task.ownerId !== me?.id ? task.ownerId : null;
  const stored = task.parked ? task.parkUntil : null;
  return {
    personId: task.parked ? task.parkedOnId : owner,
    until: stored && stored >= today ? stored : defaultReviewDay(today),
  };
}

export function parkedOnName(task: Task, people: Person[]): string | null {
  return people.find((person) => person.id === task.parkedOnId)?.name ?? null;
}

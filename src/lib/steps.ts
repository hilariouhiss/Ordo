import type { Step } from "../model/types";
import { t } from "./i18n";

/** Steps arrive sorted by sort_order; the current one is the first still open. */
export function currentStep(steps: Step[]): Step | null {
  return steps.find((step) => !step.done) ?? null;
}

export function stepsDone(steps: Step[]): number {
  return steps.filter((step) => step.done).length;
}

/** The dim line under a task title: "当前步骤 · 写导出按钮". */
export function stepLabel(steps: Step[]): string | null {
  const step = currentStep(steps);
  return step ? `${t("task.currentStep")} · ${step.title}` : null;
}

export interface AllocatedStep {
  id: string;
  minutes: number;
  /** True when the share is computed from the task effort rather than set by hand. */
  auto: boolean;
}

export interface StepAllocation {
  steps: AllocatedStep[];
  allocated: number;
  manualCount: number;
}

/**
 * Gives manual steps their minutes and splits the rest evenly across automatic ones.
 * Rounding pennies of an hour go to the earliest automatic steps.
 */
export function allocateSteps(totalMinutes: number, steps: Step[]): StepAllocation {
  const manualTotal = steps.reduce((sum, step) => sum + (step.effortMinutes ?? 0), 0);
  const autoCount = steps.filter((step) => step.effortMinutes == null).length;
  const remaining = Math.max(0, totalMinutes - manualTotal);
  const base = autoCount ? Math.floor(remaining / autoCount) : 0;
  let extra = autoCount ? remaining % autoCount : 0;

  const rows = steps.map((step) => {
    if (step.effortMinutes != null) {
      return { id: step.id, minutes: step.effortMinutes, auto: false };
    }
    const minutes = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    return { id: step.id, minutes, auto: true };
  });

  return {
    steps: rows,
    allocated: rows.reduce((sum, row) => sum + row.minutes, 0),
    manualCount: steps.length - autoCount,
  };
}

/** A compact h:mm label for a step's share. */
export function formatStepClock(minutes: number): string {
  const value = Math.max(0, Math.round(minutes));
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, "0")}`;
}

/** Hours and minutes, never days: a whole task day reads as 8 小时 on the step bar. */
export function formatStepEffort(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const parts: string[] = [];
  if (hours) parts.push(t("effort.hours", { hours }));
  if (rest) {
    parts.push(t(parts.length ? "effort.minutesShort" : "effort.minutes", { minutes: rest }));
  }
  return parts.length ? parts.join(" ") : t("effort.minutes", { minutes: 0 });
}

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

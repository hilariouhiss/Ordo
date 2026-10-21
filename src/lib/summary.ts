import { shortDate } from "./dates";
import { t } from "./i18n";

export interface SummaryInput {
  name: string;
  dueDate: string | null;
  total: number;
  done: number;
  byCategory: { name: string; total: number; done: number }[];
}

/** The copyable project line; kept on this side so it follows the UI language. */
export function projectSummaryLine(project: SummaryInput): string {
  const head = project.dueDate
    ? t("summary.headDue", {
        name: project.name,
        date: shortDate(project.dueDate),
        total: project.total,
        done: project.done,
      })
    : t("summary.head", { name: project.name, total: project.total, done: project.done });
  const parts = project.byCategory
    .filter((category) => category.total > 0)
    .map((category) =>
      category.done === 0
        ? t("summary.notStarted", { name: category.name })
        : t("summary.progress", {
            name: category.name,
            done: category.done,
            total: category.total,
          }),
    );
  if (!parts.length) return t("summary.lineSolo", { head });
  return t("summary.line", { head, parts: parts.join(t("summary.join")) });
}

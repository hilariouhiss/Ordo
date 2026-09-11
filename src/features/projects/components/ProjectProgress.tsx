import { Show, createMemo } from "solid-js";
import { differenceInCalendarDays, formatDistanceToNowStrict } from "date-fns";
import { zhCN } from "date-fns/locale";
import type { Task } from "../../tasks/types";

export interface ProjectProgressProps {
  /** The project's own tasks; the panel derives everything from them. */
  tasks: Task[];
  /** The project's due date (ISO), if it has one. */
  dueAt: string | null;
}

/**
 * Project progress summary (ST-03): the overall bar, the completion rate, how
 * much work is left and how long there is until the due date.
 *
 * Every number derives from the live task list handed in — the project view
 * passes its reactive store slice — so checking a task moves the bar, the
 * rate and the remaining count in the same tick, without a backend round
 * trip. The countdown is read at render time, like the task views' due
 * labels; the panel never runs a timer of its own.
 */
export function ProjectProgress(props: ProjectProgressProps) {
  const total = createMemo(() => props.tasks.length);
  const done = createMemo(() => props.tasks.filter((task) => task.completedAt !== null).length);
  const remaining = createMemo(() => total() - done());
  const rate = createMemo(() => (total() === 0 ? 0 : Math.round((done() / total()) * 100)));

  // Project due dates are stored as the end of the local day
  // (`localDateValueToIso`), so a same-day deadline is still "today" all day.
  const due = createMemo(() => {
    if (!props.dueAt) return null;
    const date = new Date(props.dueAt);
    if (Number.isNaN(date.getTime())) return null;

    const days = differenceInCalendarDays(date, new Date());
    if (days === 0) return { text: "今天截止", overdue: false };
    const distance = formatDistanceToNowStrict(date, { locale: zhCN });
    return days < 0
      ? { text: `已逾期 ${distance}`, overdue: true }
      : { text: `距截止还有 ${distance}`, overdue: false };
  });

  return (
    <div class="flex flex-col gap-1.5">
      <div class="flex items-center gap-3">
        <div
          class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover"
          role="progressbar"
          aria-label={`完成率 ${rate()}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={rate()}
        >
          <div
            class="h-full w-full origin-left rounded-full bg-primary transition-transform motion-reduce:transition-none"
            style={{ transform: `scaleX(${rate() / 100})` }}
          />
        </div>
        <span class="shrink-0 text-xs font-medium tabular-nums text-foreground">{rate()}%</span>
      </div>

      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span role="status">
          {done()} / {total()} 已完成
        </span>
        <span>剩余 {remaining()} 项</span>
        <Show when={due()}>
          {(deadline) => (
            <span classList={{ "text-danger": deadline().overdue }}>{deadline().text}</span>
          )}
        </Show>
      </div>
    </div>
  );
}

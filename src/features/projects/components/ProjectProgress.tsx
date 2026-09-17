import { createMemo } from "solid-js";

export interface ProjectProgressProps {
  /** 顶层任务总数；口径由调用方决定（项目页传自己范围的行，命名空间页传聚合）。 */
  total: number;
  completed: number;
}

/**
 * Project progress summary (ST-03): the overall bar, the completion rate and
 * how much work is left.
 *
 * The two numbers arrive from the caller — the project view counts its own
 * scope's rows, the namespace page hands in the server's tally — so the panel
 * renders whatever口径 the surface above it decided on. No countdown: projects
 * have no deadline (R2) — task and subtask due dates are where time pressure
 * lives.
 *
 * The percentage is the project's headline number, so it is set at label size
 * beside the bar rather than tucked away at caption size.
 */
export function ProjectProgress(props: ProjectProgressProps) {
  const total = () => props.total;
  const done = () => props.completed;
  const remaining = createMemo(() => total() - done());
  const rate = createMemo(() => (total() === 0 ? 0 : Math.round((done() / total()) * 100)));

  return (
    <div class="flex flex-col gap-2">
      <div class="flex items-center gap-3">
        <div
          class="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover"
          role="progressbar"
          aria-label={`完成率 ${rate()}%`}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={rate()}
        >
          <div
            class="h-full w-full origin-left rounded-full bg-primary transition-transform duration-300 ease-out"
            style={{ transform: `scaleX(${rate() / 100})` }}
          />
        </div>
        <span class="w-10 shrink-0 text-right text-sm font-semibold text-foreground">
          {rate()}%
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span role="status">
          {done()} / {total()} 已完成
        </span>
        <span aria-hidden="true" class="text-border-strong">
          ·
        </span>
        <span>剩余 {remaining()} 项</span>
      </div>
    </div>
  );
}

import { Show, createMemo, createSignal } from "solid-js";
import { format } from "date-fns";
import { Button } from "../../../common/components";
import { formatDuration } from "../../tasks/time";
import { useStats } from "../hooks";
import { RANGE_OPTIONS, bucketKeys, parseDayKey, rangeSpec, type StatsRangeKey } from "../series";
import type { TimeGroupBy } from "../types";
import { BarList } from "./BarList";
import { CalendarHeatmap } from "./CalendarHeatmap";
import { LineChart } from "./LineChart";
import { SegmentedControl } from "./SegmentedControl";

const GROUP_OPTIONS: readonly { value: TimeGroupBy; label: string }[] = [
  { value: "project", label: "按项目" },
  { value: "tag", label: "按标签" },
];

const PANEL_CLASS = "rounded-lg border border-border bg-surface p-4";

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Axis tick label: `M/d` for day/week buckets, `M 月` for month buckets. */
function axisLabel(key: string): string {
  return key.length === 7 ? `${Number(key.slice(5))} 月` : format(parseDayKey(key), "M/d");
}

/**
 * The `/stats` view (ST-02): completion trend, calendar heatmap, project
 * comparison and time distribution — all hand-drawn SVG, no chart library.
 *
 * The view owns the range and grouping dimension; `useStats` turns them into
 * the backend's local-calendar queries, and `series.ts` lays out the axis the
 * backend may have left gaps in.
 */
export function StatsView() {
  const [rangeKey, setRangeKey] = createSignal<StatsRangeKey>("7d");
  const [groupBy, setGroupBy] = createSignal<TimeGroupBy>("project");
  const range = createMemo(() => rangeSpec(rangeKey()));
  const keys = createMemo(() => bucketKeys(range()));
  const stats = useStats(range, groupBy);

  const completed = createMemo(() => sum(stats.trend()));
  const trackedTotal = createMemo(() => sum(stats.tracked()));

  /** Completion rate per project; the bar is the rate, the hint the count. */
  const projectRows = createMemo(() =>
    stats.projects().map((project) => ({
      id: project.projectId,
      label: project.name,
      value: project.total === 0 ? 0 : project.completed / project.total,
      hint: `${project.completed}/${project.total} 个任务`,
    })),
  );

  const shareRows = createMemo(() => {
    const groups = stats.shares();
    const total = sum(groups.map((group) => group.seconds));
    return groups.map((group) => ({
      id: group.id ?? "unassigned",
      label: group.name ?? "未归属项目",
      value: group.seconds,
      hint: total === 0 ? "0%" : `${Math.round((group.seconds / total) * 100)}%`,
    }));
  });

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex items-center justify-between gap-3 border-b border-border px-6 py-3">
        <h1 class="text-sm font-medium text-foreground">统计</h1>
        <SegmentedControl
          label="统计范围"
          options={RANGE_OPTIONS}
          value={rangeKey()}
          onChange={setRangeKey}
        />
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        <Show
          when={!stats.failed()}
          fallback={
            <div
              role="alert"
              class="flex flex-col items-center gap-3 rounded-lg border border-danger/40 bg-danger/5 p-8 text-center"
            >
              <p class="text-sm text-danger">统计数据加载失败，请重试。</p>
              <Button variant="secondary" size="sm" onClick={stats.retry}>
                重试
              </Button>
            </div>
          }
        >
          <Show
            when={stats.ready()}
            fallback={
              <p role="status" class="py-8 text-center text-sm text-muted-foreground">
                加载中…
              </p>
            }
          >
            <div class="flex flex-col gap-4">
              <section aria-label="完成趋势" class={PANEL_CLASS}>
                <div class="flex items-baseline justify-between gap-3">
                  <h2 class="text-sm font-medium text-foreground">完成趋势</h2>
                  <span class="text-xs text-subtle-foreground">共 {completed()} 个完成</span>
                </div>
                <LineChart
                  keys={keys()}
                  values={stats.trend()}
                  formatKey={axisLabel}
                  formatValue={(value) => `${value} 个`}
                  label="完成趋势"
                />
              </section>

              <section aria-label="日历热力图" class={PANEL_CLASS}>
                <h2 class="pb-3 text-sm font-medium text-foreground">日历热力图</h2>
                <CalendarHeatmap days={range().days} values={stats.daily()} />
              </section>

              <section aria-label="项目进度" class={PANEL_CLASS}>
                <h2 class="pb-3 text-sm font-medium text-foreground">项目进度对比</h2>
                <BarList
                  rows={projectRows()}
                  max={1}
                  formatValue={(value) => `${Math.round(value * 100)}%`}
                  emptyLabel="还没有项目"
                />
              </section>

              <section aria-label="时间分布" class={PANEL_CLASS}>
                <div class="flex items-center justify-between gap-3 pb-3">
                  <h2 class="text-sm font-medium text-foreground">
                    时间分布
                    <span class="pl-2 text-xs font-normal text-subtle-foreground">
                      共 {formatDuration(trackedTotal())}
                    </span>
                  </h2>
                  <SegmentedControl
                    label="时间分布维度"
                    options={GROUP_OPTIONS}
                    value={groupBy()}
                    onChange={setGroupBy}
                  />
                </div>
                <BarList
                  rows={shareRows()}
                  max={Math.max(0, ...shareRows().map((row) => row.value))}
                  formatValue={formatDuration}
                  emptyLabel="该范围内还没有时间记录"
                />

                <h3 class="pb-1 pt-4 text-xs font-medium text-subtle-foreground">
                  记录时长趋势
                </h3>
                <LineChart
                  keys={keys()}
                  values={stats.tracked()}
                  formatKey={axisLabel}
                  formatValue={formatDuration}
                  label="记录时长趋势"
                />
              </section>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}

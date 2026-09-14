import { CircleAlert } from "lucide-solid";
import { Button, EmptyState, Skeleton, SkeletonRows } from "../../../../common/components";

/** Row widths for the placeholder list: uneven on purpose, so six identical
 * bars don't read as a table. */
const ROW_WIDTHS = ["58%", "41%", "66%", "35%", "49%", "44%"];

/**
 * Shown while the initial `loadAll` is in flight.
 *
 * A skeleton of the real layout rather than the words "加载中…": the pane keeps
 * its final shape, so the list does not jump into place when data lands. The
 * single `role="status"` still announces the state — the placeholder blocks
 * carry no text, so they add nothing to its accessible name.
 */
export function LoadingPane() {
  return (
    <div role="status" class="h-full min-h-64">
      <span class="sr-only">加载中…</span>
      <div aria-hidden="true">
        <div class="flex h-12 items-center gap-2 border-b border-border px-5">
          <Skeleton class="h-4 w-20" />
          <div class="ml-auto flex items-center gap-2">
            <Skeleton class="h-8 w-24" />
            <Skeleton class="h-8 w-24" />
            <Skeleton class="h-8 w-20" />
          </div>
        </div>
        <SkeletonRows widths={ROW_WIDTHS} />
      </div>
    </div>
  );
}

/** Shown when `loadAll` failed; the retry button re-runs it. */
export function LoadErrorPane(props: { onRetry: () => void }) {
  return (
    <div role="alert" class="flex h-full min-h-64 flex-col">
      <EmptyState
        icon={<CircleAlert size={22} />}
        title="加载失败"
        description="任务数据没能读出来。检查一下数据文件是否可访问，然后重试。"
        action={
          <Button variant="secondary" onClick={props.onRetry}>
            重试
          </Button>
        }
      />
    </div>
  );
}

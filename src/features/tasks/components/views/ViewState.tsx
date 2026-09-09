import { Button } from "../../../../common/components";

/** Shown while the initial `loadAll` is in flight. */
export function LoadingPane() {
  return (
    <div
      role="status"
      class="flex h-full min-h-64 flex-col items-center justify-center p-8 text-sm text-muted-foreground"
    >
      加载中…
    </div>
  );
}

/** Shown when `loadAll` failed; the retry button re-runs it. */
export function LoadErrorPane(props: { onRetry: () => void }) {
  return (
    <div
      role="alert"
      class="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-8 text-center"
    >
      <h2 class="text-base font-semibold text-foreground">加载失败</h2>
      <p class="text-sm text-muted-foreground">任务数据加载失败，请重试。</p>
      <Button variant="secondary" size="sm" onClick={props.onRetry}>
        重试
      </Button>
    </div>
  );
}

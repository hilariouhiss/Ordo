import { Show, createMemo } from "solid-js";
import { tasksState } from "../../store";
import { viewCompleted } from "../../view-filters";
import { SORT_OPTIONS, TaskListView } from "../TaskListView";
import { LoadErrorPane, LoadingPane } from "./ViewState";
import { useViewData } from "./useViewData";

export function CompletedView() {
  const { failed, retry } = useViewData();
  const tasks = createMemo(() => viewCompleted(tasksState.tasks));

  return (
    <Show
      when={tasksState.loaded}
      fallback={
        <Show when={!failed()} fallback={<LoadErrorPane onRetry={() => void retry()} />}>
          <LoadingPane />
        </Show>
      }
    >
      <TaskListView
        tasks={tasks}
        emptyTitle="还没有完成的任务"
        emptyDescription="完成的任务会归档在这里，取消勾选即可恢复为待办。"
        defaultSort="recent"
        sortOptions={[SORT_OPTIONS.recent, SORT_OPTIONS.priority, SORT_OPTIONS.due]}
      />
    </Show>
  );
}

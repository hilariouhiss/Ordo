import { Show, createMemo, createSignal } from "solid-js";
import { tasksState } from "../../store";
import { viewToday } from "../../view-filters";
import { SORT_OPTIONS, TaskListView } from "../TaskListView";
import { LoadErrorPane, LoadingPane } from "./ViewState";
import { useViewData } from "./useViewData";

export function TodayView() {
  const { failed, retry } = useViewData();
  // Fixed at mount: crossing midnight mid-session refreshes on the next
  // store change rather than silently reordering rows.
  const [now] = createSignal(new Date());
  const tasks = createMemo(() => viewToday(tasksState.tasks, now()));

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
        emptyTitle="今天没有到期任务"
        emptyDescription="今日与逾期到期的任务会集中在这里，勾选即可完成。"
        defaultSort="manual"
        sortOptions={[SORT_OPTIONS.manual, SORT_OPTIONS.priority, SORT_OPTIONS.due]}
      />
    </Show>
  );
}

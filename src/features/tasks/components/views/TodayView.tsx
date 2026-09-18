import { Show, createMemo } from "solid-js";
import { createNow } from "../../../../common/clock";
import { tasks as allTasks, tasksState } from "../../store";
import { viewToday } from "../../view-filters";
import { SORT_OPTIONS, TaskListView } from "../TaskListView";
import { LoadErrorPane, LoadingPane } from "./ViewState";
import { useViewData } from "./useViewData";

export function TodayView() {
  const { failed, retry } = useViewData();
  // A live clock, so a session open across midnight moves the day boundary
  // with it (QA-02) instead of freezing on the mount-time date.
  const now = createNow();
  const tasks = createMemo(() => viewToday(allTasks(), now()));

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
        title="今天"
        emptyTitle="今天没有到期任务"
        emptyDescription="今日与逾期到期的任务会集中在这里，勾选即可完成。"
        defaultSort="manual"
        sortOptions={[SORT_OPTIONS.manual, SORT_OPTIONS.priority, SORT_OPTIONS.due]}
      />
    </Show>
  );
}

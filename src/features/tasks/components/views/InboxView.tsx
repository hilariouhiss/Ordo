import { Show, createMemo } from "solid-js";
import { tasks as allTasks, tasksState } from "../../store";
import { viewInbox } from "../../view-filters";
import { SORT_OPTIONS, TaskListView } from "../TaskListView";
import { LoadErrorPane, LoadingPane } from "./ViewState";
import { useViewData } from "./useViewData";

export function InboxView() {
  const { failed, retry } = useViewData();
  const tasks = createMemo(() => viewInbox(allTasks()));

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
        title="收件箱"
        emptyTitle="收件箱是空的"
        emptyDescription="未归属任何项目的任务会收集在这里，随时可以把它们分配到项目里。"
        defaultSort="manual"
        sortOptions={[SORT_OPTIONS.manual, SORT_OPTIONS.priority, SORT_OPTIONS.due]}
      />
    </Show>
  );
}

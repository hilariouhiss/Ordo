import { Show, createMemo, createSignal } from "solid-js";
import { createNow } from "../../../../common/clock";
import { Select } from "../../../../common/components";
import { tasks as allTasks, tasksState } from "../../store";
import { viewUpcoming } from "../../view-filters";
import { SORT_OPTIONS, TaskListView } from "../TaskListView";
import { LoadErrorPane, LoadingPane } from "./ViewState";
import { useViewData } from "./useViewData";

const RANGE_OPTIONS = [7, 14, 30].map((days) => ({
  value: String(days),
  label: `未来 ${days} 天`,
}));

export function UpcomingView() {
  const { failed, retry } = useViewData();
  const now = createNow();
  const [days, setDays] = createSignal(7);
  const tasks = createMemo(() => viewUpcoming(allTasks(), days(), now()));

  const selectedRange = () =>
    RANGE_OPTIONS.find((option) => option.value === String(days())) ?? RANGE_OPTIONS[0];

  const rangeSelect = (
    <Select.Root
      options={RANGE_OPTIONS}
      optionValue={(option) => option.value}
      optionTextValue={(option) => option.label}
      itemToString={(option) => option.label}
      value={selectedRange()}
      onChange={(option) => setDays(Number(option?.value ?? 7))}
    >
      <Select.Label class="sr-only">时间范围</Select.Label>
      <Select.Trigger class="w-24">
        <Select.Value>{selectedRange().label}</Select.Value>
        <Select.Icon />
      </Select.Trigger>
      <Select.Content>
        <Select.Listbox />
      </Select.Content>
    </Select.Root>
  );

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
        title="即将到来"
        toolbarExtra={rangeSelect}
        emptyTitle="近期没有到期任务"
        emptyDescription="未来所选范围内的到期任务会在这里排队。"
        defaultSort="due"
        sortOptions={[SORT_OPTIONS.due, SORT_OPTIONS.manual, SORT_OPTIONS.priority]}
      />
    </Show>
  );
}

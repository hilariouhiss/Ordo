import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import { Check, Plus, Tag as TagIcon } from "lucide-solid";
import { Button, DropdownMenu, Select, VirtualList } from "../../../common/components";
import { completeTask, softDeleteTask, uncompleteTask } from "../hooks";
import { tasksState } from "../store";
import type { Priority, Task } from "../types";
import { applyFilter, sortTasks, type SortMode } from "../view-filters";
import { TaskDetailDialog } from "./TaskDetailDialog";
import { TaskEditorDialog } from "./TaskEditorDialog";
import { TaskItemRow } from "./TaskItemRow";
import { TagManagerDialog } from "./TagManagerDialog";

/** Must match the row height in `TaskItemRow` (VirtualList v1 is fixed-height). */
const ROW_HEIGHT = 56;

export type SortOption = { value: SortMode; label: string };

export const SORT_OPTIONS = {
  manual: { value: "manual", label: "手动排序" },
  priority: { value: "priority", label: "按优先级" },
  due: { value: "due", label: "按截止日期" },
  recent: { value: "recent", label: "最近完成" },
  tag: { value: "tag", label: "按标签" },
} as const satisfies Record<SortMode, SortOption>;

const PRIORITY_FILTER_OPTIONS: Array<{ value: Priority | "all"; label: string }> = [
  { value: "all", label: "全部优先级" },
  { value: "high", label: "仅高" },
  { value: "medium", label: "仅中" },
  { value: "low", label: "仅低" },
  { value: "none", label: "仅无" },
];

export interface TaskListViewProps {
  /** View-filtered tasks (Inbox/Today/…); filter + sort are applied here. */
  tasks: () => readonly Task[];
  emptyTitle: string;
  emptyDescription: string;
  defaultSort: SortMode;
  sortOptions: SortOption[];
  /** Extra toolbar control, e.g. the Upcoming range select. */
  toolbarExtra?: JSX.Element;
  /** New tasks created from this list join this project (project detail view). */
  defaultProjectId?: string;
}

/**
 * Shared layout of the four task views (T-05): a toolbar (create button,
 * priority/tag filters, sort mode, count) above a virtualized task list,
 * with the create/edit dialog wired in.
 */
export function TaskListView(props: TaskListViewProps) {
  const [priorityFilter, setPriorityFilter] = createSignal<Priority | "all">("all");
  const [tagFilter, setTagFilter] = createSignal<string[]>([]);
  const [sortMode, setSortMode] = createSignal<SortMode>(props.defaultSort);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingTask, setEditingTask] = createSignal<Task | null>(null);
  const [detailOpen, setDetailOpen] = createSignal(false);
  const [detailTask, setDetailTask] = createSignal<Task | null>(null);
  const [managerOpen, setManagerOpen] = createSignal(false);
  // Captured once so day boundaries don't flap between rows mid-render.
  const [now] = createSignal(new Date());

  const visible = createMemo(() =>
    sortTasks(
      applyFilter(props.tasks(), { priority: priorityFilter(), tagIds: tagFilter() }),
      sortMode(),
      tasksState.tags,
    ),
  );

  const selectedPriority = () =>
    PRIORITY_FILTER_OPTIONS.find((option) => option.value === priorityFilter()) ??
    PRIORITY_FILTER_OPTIONS[0];
  const selectedSort = () =>
    props.sortOptions.find((option) => option.value === sortMode()) ?? props.sortOptions[0];

  const toggleTagFilter = (id: string) =>
    setTagFilter((ids) => (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]));

  const openCreate = () => {
    setEditingTask(null);
    setEditorOpen(true);
  };
  const openEdit = (task: Task) => {
    setEditingTask(task);
    setEditorOpen(true);
  };
  const openDetail = (task: Task) => {
    setDetailTask(task);
    setDetailOpen(true);
  };
  /** The detail's 编辑 button: swap the detail dialog for the editor. */
  const openEditFromDetail = (task: Task) => {
    setDetailOpen(false);
    openEdit(task);
  };
  const toggleComplete = (task: Task) => {
    void (task.completedAt ? uncompleteTask(task.id) : completeTask(task.id));
  };
  const removeTask = (task: Task) => {
    void softDeleteTask(task.id);
  };

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex flex-wrap items-center gap-2 border-b border-border px-6 py-2.5">
        {props.toolbarExtra}

        <Select.Root
          options={PRIORITY_FILTER_OPTIONS}
          optionValue={(option) => option.value}
          optionTextValue={(option) => option.label}
          itemToString={(option) => option.label}
          value={selectedPriority()}
          onChange={(option) => setPriorityFilter(option?.value ?? "all")}
        >
          <Select.Label class="sr-only">优先级筛选</Select.Label>
          <Select.Trigger class="h-8 w-32 px-2.5 text-xs">
            <Select.Value>{selectedPriority().label}</Select.Value>
            <Select.Icon />
          </Select.Trigger>
          <Select.Content>
            <Select.Listbox />
          </Select.Content>
        </Select.Root>

        <Show when={tasksState.tags.length > 0}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              aria-label="按标签筛选"
              class="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-xs text-muted-foreground transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <TagIcon size={14} aria-hidden="true" />
              标签
              <Show when={tagFilter().length > 0}>
                <span class="rounded-full bg-primary/10 px-1.5 text-primary">
                  {tagFilter().length}
                </span>
              </Show>
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                <For each={tasksState.tags}>
                  {(tag) => (
                    <DropdownMenu.Item
                      closeOnSelect={false}
                      onSelect={() => toggleTagFilter(tag.id)}
                    >
                      <span class="flex size-3.5 shrink-0 items-center justify-center">
                        <Show when={tagFilter().includes(tag.id)}>
                          <Check size={14} class="text-primary" aria-hidden="true" />
                        </Show>
                      </span>
                      <span
                        class="size-2 rounded-full"
                        style={{ "background-color": tag.color ?? "var(--border)" }}
                      />
                      {tag.name}
                    </DropdownMenu.Item>
                  )}
                </For>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </Show>

        <Button
          variant="ghost"
          size="sm"
          class="h-8 px-2.5 text-xs text-muted-foreground"
          onClick={() => setManagerOpen(true)}
        >
          <TagIcon size={14} aria-hidden="true" />
          管理标签
        </Button>

        <Select.Root
          options={props.sortOptions}
          optionValue={(option) => option.value}
          optionTextValue={(option) => option.label}
          itemToString={(option) => option.label}
          value={selectedSort()}
          onChange={(option) => setSortMode(option?.value ?? props.defaultSort)}
        >
          <Select.Label class="sr-only">排序方式</Select.Label>
          <Select.Trigger class="h-8 w-32 px-2.5 text-xs">
            <Select.Value>{selectedSort().label}</Select.Value>
            <Select.Icon />
          </Select.Trigger>
          <Select.Content>
            <Select.Listbox />
          </Select.Content>
        </Select.Root>

        <span class="ml-auto text-xs text-subtle-foreground">{visible().length} 个任务</span>

        <Button size="sm" variant="secondary" onClick={openCreate}>
          <Plus size={14} aria-hidden="true" />
          新建任务
        </Button>
      </div>

      <Show
        when={visible().length > 0}
        fallback={
          <div class="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
            <Show
              when={props.tasks().length === 0}
              fallback={
                <>
                  <h2 class="text-base font-semibold text-foreground">没有符合筛选条件的任务</h2>
                  <p class="text-sm text-muted-foreground">调整优先级或标签筛选后再试。</p>
                </>
              }
            >
              <h2 class="text-base font-semibold text-foreground">{props.emptyTitle}</h2>
              <p class="max-w-sm text-sm text-muted-foreground">{props.emptyDescription}</p>
            </Show>
          </div>
        }
      >
        <VirtualList
          class="min-h-0 flex-1 overflow-y-auto"
          items={visible()}
          itemHeight={ROW_HEIGHT}
          getKey={(task) => task.id}
        >
          {(task) => (
            <TaskItemRow
              task={task}
              now={now()}
              onToggleComplete={toggleComplete}
              onOpenDetail={openDetail}
              onEdit={openEdit}
              onDelete={removeTask}
            />
          )}
        </VirtualList>
      </Show>

      <TaskEditorDialog
        open={editorOpen()}
        onOpenChange={setEditorOpen}
        task={editingTask() ?? undefined}
        defaultProjectId={props.defaultProjectId}
      />

      <TagManagerDialog open={managerOpen()} onOpenChange={setManagerOpen} />

      <Show when={detailTask()}>
        {(task) => (
          <TaskDetailDialog
            open={detailOpen()}
            onOpenChange={setDetailOpen}
            task={task()}
            onEdit={openEditFromDetail}
          />
        )}
      </Show>
    </div>
  );
}

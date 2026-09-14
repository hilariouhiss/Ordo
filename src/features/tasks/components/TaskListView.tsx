import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import { Check, ListFilter, ListTodo, Plus, Tag as TagIcon } from "lucide-solid";
import { Button, DropdownMenu, EmptyState, Select, VirtualList } from "../../../common/components";
import { completeSubtask, completeTask, softDeleteTask, uncompleteTask } from "../hooks";
import { getSubtasks, tasksState } from "../store";
import type { Priority, Subtask, Task } from "../types";
import { applyFilter, sortTasks, type SortMode } from "../view-filters";
import { SubtaskRow } from "./SubtaskRow";
import { TaskDetailDialog } from "./TaskDetailDialog";
import { TaskEditorDialog } from "./TaskEditorDialog";
import { TaskItemRow } from "./TaskItemRow";
import { TagManagerDialog } from "./TagManagerDialog";

/** Must match the row height in `TaskItemRow` (VirtualList v1 is fixed-height). */
const ROW_HEIGHT = 56;

/**
 * One rendered line. The tree is flattened into this, so every row keeps the
 * same 56px height the virtualizer assumes — teaching `VirtualList` to measure
 * variable rows would mean rewriting a primitive four other views depend on.
 */
type ListRow =
  | { kind: "task"; task: Task; subtaskCount: number; subtaskDone: number }
  | { kind: "subtask"; task: Task; subtask: Subtask };

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

/*
 * Shared look of the toolbar's filter controls, matching the select triggers
 * beside them: same height, same border, same text tier. The three filters
 * reading as one family is what stops the row looking assembled by accident.
 */
const FILTER_CLASS =
  "flex h-8 select-none items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 text-sm text-muted-foreground transition duration-150 ease-out hover:border-border-strong hover:text-foreground focus-ring";

export interface TaskListViewProps {
  /** Page title. Omitted where a parent header already names the view (the
   * project detail's own header sits directly above this toolbar). */
  title?: string;
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
 * Shared layout of the four task views (T-05): one toolbar carrying the page
 * title, the count and the filters, above a virtualized task list.
 *
 * The title lives here rather than in an app-level header bar so each view
 * owns exactly one heading — the same word rendered twice, 56px apart, was
 * the single most obvious tell that the chrome had never been revisited.
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

  /** Expanded task ids. Local only: the subtasks are already in the store, so
   * expanding never hits the backend. */
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});

  // After `visible`, not before it: Solid runs a memo's body eagerly as it is
  // created, so reading `visible` from above its own `const` is a TDZ crash.
  const rows = createMemo<ListRow[]>(() =>
    visible().flatMap((task) => {
      const children = getSubtasks(task.id);
      const done = children.filter((child) => child.done).length;
      const head: ListRow = {
        kind: "task",
        task,
        subtaskCount: children.length,
        subtaskDone: done,
      };
      if (children.length === 0 || !expanded()[task.id]) return [head];
      // The return annotation is load-bearing too: without it the literal's
      // `kind` widens to `string` and the array stops being a `ListRow[]`.
      return [head, ...children.map((subtask): ListRow => ({ kind: "subtask", task, subtask }))];
    }),
  );

  const toggleExpand = (task: Task) =>
    setExpanded((current) => ({ ...current, [task.id]: !current[task.id] }));

  const toggleSubtask = (task: Task, subtask: Subtask, done: boolean) => {
    void completeSubtask(task.id, subtask.id, done);
  };

  const filtered = () => priorityFilter() !== "all" || tagFilter().length > 0;
  const clearFilters = () => {
    setPriorityFilter("all");
    setTagFilter([]);
  };

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
      <div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-5">
        <Show when={props.title}>
          {(title) => (
            <h1 class="mr-1 shrink-0 text-base font-semibold tracking-tight">{title()}</h1>
          )}
        </Show>
        <span class="shrink-0 text-xs text-subtle-foreground">{visible().length} 个任务</span>

        <div class="ml-auto flex shrink-0 items-center gap-2">
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
            <Select.Trigger class="w-28">
              <Select.Value>{selectedPriority().label}</Select.Value>
              <Select.Icon />
            </Select.Trigger>
            <Select.Content>
              <Select.Listbox />
            </Select.Content>
          </Select.Root>

          {/* Always rendered, tag list or not: 管理标签 used to be its own
              toolbar button, so with zero tags there was no way in at all. */}
          <DropdownMenu.Root>
            <DropdownMenu.Trigger aria-label="按标签筛选" class={FILTER_CLASS}>
              <TagIcon size={13} aria-hidden="true" />
              标签
              <Show when={tagFilter().length > 0}>
                <span class="rounded-full bg-primary/15 px-1.5 text-primary">
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
                          <Check size={13} class="text-primary" aria-hidden="true" />
                        </Show>
                      </span>
                      <span
                        class="size-2 shrink-0 rounded-full"
                        style={{ "background-color": tag.color ?? "var(--border-strong)" }}
                      />
                      {tag.name}
                    </DropdownMenu.Item>
                  )}
                </For>
                <Show when={tasksState.tags.length > 0}>
                  <DropdownMenu.Separator />
                </Show>
                <DropdownMenu.Item onSelect={() => setManagerOpen(true)}>
                  <TagIcon size={13} aria-hidden="true" />
                  管理标签
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          <Select.Root
            options={props.sortOptions}
            optionValue={(option) => option.value}
            optionTextValue={(option) => option.label}
            itemToString={(option) => option.label}
            value={selectedSort()}
            onChange={(option) => setSortMode(option?.value ?? props.defaultSort)}
          >
            <Select.Label class="sr-only">排序方式</Select.Label>
            <Select.Trigger class="w-28">
              <Select.Value>{selectedSort().label}</Select.Value>
              <Select.Icon />
            </Select.Trigger>
            <Select.Content>
              <Select.Listbox />
            </Select.Content>
          </Select.Root>

          {/* Hidden while the list is empty: the empty state's own button is
              then the only way to create, so the view never shows two controls
              with the same action. */}
          <Show when={visible().length > 0}>
            <Button size="sm" onClick={openCreate}>
              <Plus size={14} aria-hidden="true" />
              新建任务
            </Button>
          </Show>
        </div>
      </div>

      <Show
        when={visible().length > 0}
        fallback={
          <Show
            when={filtered()}
            fallback={
              <EmptyState
                icon={<ListTodo size={22} />}
                title={props.emptyTitle}
                description={props.emptyDescription}
                action={
                  <Button size="sm" onClick={openCreate}>
                    <Plus size={14} aria-hidden="true" />
                    新建任务
                  </Button>
                }
              />
            }
          >
            <EmptyState
              icon={<ListFilter size={22} />}
              title="没有符合筛选条件的任务"
              description="当前的优先级或标签筛选把这一组任务全部排除了。"
              action={
                <Button size="sm" variant="secondary" onClick={clearFilters}>
                  清除筛选
                </Button>
              }
            />
          </Show>
        }
      >
        <VirtualList
          class="min-h-0 flex-1 overflow-y-auto"
          items={rows()}
          itemHeight={ROW_HEIGHT}
          getKey={(row) => (row.kind === "task" ? row.task.id : row.subtask.id)}
        >
          {(row) =>
            row.kind === "task" ? (
              <TaskItemRow
                task={row.task}
                now={now()}
                subtaskCount={row.subtaskCount}
                subtaskDone={row.subtaskDone}
                expanded={Boolean(expanded()[row.task.id])}
                onToggleExpand={toggleExpand}
                onToggleComplete={toggleComplete}
                onOpenDetail={openDetail}
                onEdit={openEdit}
                onDelete={removeTask}
              />
            ) : (
              <SubtaskRow
                subtask={row.subtask}
                parent={row.task}
                onToggleDone={toggleSubtask}
                onOpenDetail={openDetail}
              />
            )
          }
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

import { For, Show, createMemo, createSignal, type JSX } from "solid-js";
import { Check, ListFilter, ListTodo, Plus, Tag as TagIcon } from "lucide-solid";
import { Button, DropdownMenu, EmptyState, Select, VirtualList } from "../../../common/components";
import { completeTask, softDeleteTask, uncompleteTask, updateTask } from "../hooks";
import { blockersOf, buildIndex, completionSet, isBlocked, liveSet } from "../dependencies";
import { getTask, tasksState } from "../store";
import type { Priority, Task } from "../types";
import { applyFilter, sortTasks, type SortMode } from "../view-filters";
import { SubtaskRow } from "./SubtaskRow";
import { TaskDetailDialog } from "./TaskDetailDialog";
import { TaskEditorDialog } from "./TaskEditorDialog";
import { TaskItemRow } from "./TaskItemRow";
import { TagManagerDialog } from "./TagManagerDialog";

/** Both row components carry this height as `h-14`; VirtualList v1 cannot
 * measure rows. The three copies — this number, those classes and the 20px
 * gutter — are pinned by one assertion in `task-views.test.tsx`. */
const ROW_HEIGHT = 56;

/**
 * One rendered line. The tree is flattened into this, so every row keeps the
 * same 56px height the virtualizer assumes — teaching `VirtualList` to measure
 * variable rows would mean rewriting a primitive four other views depend on.
 *
 * `child` covers both shapes a child takes under rule A: tucked under its
 * parent row, or standing in as a top-level row of its own when the parent is
 * not in this view (it then carries the parent's title as a prefix).
 */
type ListRow =
  | {
      kind: "task";
      task: Task;
      childCount: number;
      childDone: number;
      /** Prerequisites still unfinished; 0 means the row is not blocked. */
      blockerCount: number;
    }
  | { kind: "child"; task: Task; blocked: boolean; parentTitle: string | null };

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

/**
 * Children of every task in the snapshot, keyed by parent id and sorted by
 * `sortOrder` — the same order `childrenOf` hands back, built in one pass.
 *
 * Asking `childrenOf` per row instead would be O(n²) over the render pass:
 * it filters (and sorts) the whole snapshot every call, and the 10k-row
 * virtualization case in `task-views.test.tsx` is exactly that shape.
 */
function groupChildren(tasks: readonly Task[]): Map<string, Task[]> {
  const byParent = new Map<string, Task[]>();
  for (const task of tasks) {
    if (task.parentTaskId === null) continue;
    const siblings = byParent.get(task.parentTaskId);
    if (siblings) siblings.push(task);
    else byParent.set(task.parentTaskId, [task]);
  }
  for (const siblings of byParent.values()) {
    siblings.sort((a, b) => (a.sortOrder < b.sortOrder ? -1 : a.sortOrder > b.sortOrder ? 1 : 0));
  }
  return byParent;
}

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

  // The view predicate (今天/收件箱/…) already ran; this adds the toolbar
  // filters, and §8.6 decides who they touch: a row that stands on its own is
  // filtered, a child riding under its parent is context and never is.
  const visible = createMemo(() => {
    const filter = { priority: priorityFilter(), tagIds: tagFilter() };
    const all = props.tasks();
    const top = applyFilter(
      all.filter((task) => task.parentTaskId === null),
      filter,
    );
    const topIds = new Set(top.map((task) => task.id));
    const standaloneChildren = applyFilter(
      all.filter(
        (task) => task.parentTaskId !== null && !topIds.has(task.parentTaskId as string),
      ),
      filter,
    );
    return sortTasks([...top, ...standaloneChildren], sortMode(), tasksState.tags);
  });

  /** Expanded task ids. Local only: the children are already in the store, so
   * expanding never hits the backend. */
  const [expanded, setExpanded] = createSignal<Record<string, boolean>>({});

  // A child the *view* matched opens its parent (rule A): the two paths point
  // at the same child rows, and the parent's position wins, so nothing is
  // listed twice. Read from `props.tasks()` and not from `visible()` — a child
  // whose parent survived the toolbar filter never reaches `visible()` at all,
  // it is folded into that parent's row.
  const autoOpen = createMemo(() => {
    const viewIds = new Set(props.tasks().map((task) => task.id));
    return new Set(
      props.tasks()
        .filter((task) => task.parentTaskId !== null && viewIds.has(task.parentTaskId))
        .map((task) => task.parentTaskId as string),
    );
  });

  /** What is actually on screen under a parent: the user's own toggle or rule
   * A's auto-open. A row rule A holds open carries no disclosure control at all
   * (`TaskItemRow` hides it), so this drives the chevron and the child rows. */
  const isOpen = (id: string) => Boolean(expanded()[id]) || autoOpen().has(id);

  // After `visible`, not before it: Solid runs a memo's body eagerly as it is
  // created, so reading `visible` from above its own `const` is a TDZ crash.
  //
  // The live set, the dependency index and the completion set are built once
  // per pass, here, and each row is then answered from them: the per-row cost is
  // that row's own prerequisite count, not the size of the graph.
  const rows = createMemo<ListRow[]>(() => {
    const live = liveSet(tasksState.tasks);
    const index = buildIndex(tasksState.dependencies, live);
    const done = completionSet(tasksState.tasks);
    // One pass for the children and one lookup table: both are per-render-pass
    // derivations, like the dependency index above.
    const childrenByParent = groupChildren(tasksState.tasks);
    const byId = new Map(tasksState.tasks.map((task) => [task.id, task]));
    const matched = visible();
    const blockedOf = (task: Task) =>
      task.completedAt === null && isBlocked(index, done, task.id);

    const out: ListRow[] = [];
    for (const task of matched) {
      if (task.parentTaskId !== null) {
        out.push({
          kind: "child",
          task,
          blocked: blockedOf(task),
          parentTitle: byId.get(task.parentTaskId)?.title ?? "（已删除）",
        });
        continue;
      }
      const children = childrenByParent.get(task.id) ?? [];
      out.push({
        kind: "task",
        task,
        childCount: children.length,
        childDone: children.filter((child) => child.completedAt !== null).length,
        // A finished item is not waiting for anything: it wears no blocked
        // marker, or 已完成 would contradict itself (the task got there through
        // 「仍要完成」, and its prerequisite may still be open).
        blockerCount:
          task.completedAt === null ? blockersOf(index, done, task.id).length : 0,
      });
      // Children ignore the toolbar filters (§8.6): they are context for the
      // parent row, and hiding one would leave its 0/2 badge lying.
      if (children.length === 0 || !isOpen(task.id)) continue;
      for (const child of children) {
        out.push({ kind: "child", task: child, blocked: blockedOf(child), parentTitle: null });
      }
    }
    return out;
  });

  const toggleExpand = (task: Task) =>
    setExpanded((current) => ({ ...current, [task.id]: !current[task.id] }));

  /** A child row's checkbox: it is a task, so it completes through the task
   * hooks and the same blocked-confirm gate. */
  const toggleChild = (child: Task, done: boolean) => {
    void (done ? completeTask(child.id) : uncompleteTask(child.id));
  };

  /** The 父任务 prefix of a standalone child row: show the parent. */
  const openParent = (parentId: string) => {
    const parent = getTask(parentId);
    if (parent) openDetail(parent);
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

  /** R7c: a task dropped on a row is filed under it. The row already refused
   * the drops that could not be legal, so this only writes — the parent's
   * project comes along server-side. */
  const dropOnTask = (draggedId: string, target: Task) => {
    void updateTask(draggedId, { parentTaskId: target.id });
  };

  return (
    <div class="flex h-full min-h-0 flex-col">
      <div class="flex h-12 shrink-0 items-center gap-2 border-b border-border px-5">
        <Show when={props.title}>
          {(title) => (
            <h1 class="mr-1 shrink-0 text-base font-semibold tracking-tight">{title()}</h1>
          )}
        </Show>
        {/* The rows this view listed (§8.7): `visible()` holds every top-level
            row plus every standalone child, and no grouped one — a grouped
            child is part of its parent's row. So the number is the line count
            the view decided on, and it cannot change when a disclosure opens. */}
        <span class="shrink-0 text-xs text-subtle-foreground">
          {visible().length} 个任务
        </span>

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
          getKey={(row) => row.task.id}
        >
          {(row) =>
            row.kind === "task" ? (
              <TaskItemRow
                task={row.task}
                now={now()}
                subtaskCount={row.childCount}
                subtaskDone={row.childDone}
                blocked={row.blockerCount > 0}
                blockerCount={row.blockerCount}
                expanded={isOpen(row.task.id)}
                autoExpanded={autoOpen().has(row.task.id)}
                onToggleExpand={toggleExpand}
                onToggleComplete={toggleComplete}
                onOpenDetail={openDetail}
                onEdit={openEdit}
                onDelete={removeTask}
                onDropTask={dropOnTask}
              />
            ) : (
              <SubtaskRow
                task={row.task}
                parentTitle={row.parentTitle}
                blocked={row.blocked}
                onToggleDone={toggleChild}
                onOpenDetail={openDetail}
                onOpenParent={openParent}
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

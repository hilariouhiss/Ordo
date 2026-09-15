import { For, Show, createMemo, createSignal } from "solid-js";
import { ChevronDown, ChevronUp, Pencil, SlidersHorizontal, Trash2 } from "lucide-solid";
import { Badge, Checkbox, iconButtonClass } from "../../../common/components";
import {
  completeTask,
  createTask,
  reorderTask,
  softDeleteTask,
  uncompleteTask,
  updateTask,
} from "../hooks";
import { childrenOf, tasksState } from "../store";
import type { Task } from "../types";
import { buildIndex, completionSet, isBlocked, liveSet } from "../dependencies";
import { formatDueLabel, isOverdue } from "../view-filters";
import { PRIORITY_BADGES } from "./TaskItemRow";

export interface SubtaskListProps {
  taskId: string;
  /** Opens one child's own detail: a child is a task, so it has one (R7c). */
  onOpenDetail: (task: Task) => void;
  /** Hands one child to the host's editor (the detail dialog opens the same
   * `TaskEditorDialog` its 编辑 button does). */
  onEdit: (task: Task) => void;
}

/**
 * One task's child list (T-06): add via the input, rename in place, check to
 * complete, delete, and reorder with the up/down buttons. Reordering passes the
 * neighbours' sort keys around the target slot (plan §3); the hook installs the
 * authoritative sibling run it gets back.
 *
 * A child is a plain row in `tasks` (R7c), so this whole section is a filter
 * over the one snapshot: no load, no cache, and no separate write protocol.
 *
 * Three affordances, one target each: the title opens the child's *own* detail
 * (it is a task, not a label on its parent's), the pencil renames in place, and
 * the sliders hand it to the full editor — the inline input above only carries
 * a title, and a child's priority/due date/note live in that dialog.
 */
export function SubtaskList(props: SubtaskListProps) {
  const children = createMemo(() => childrenOf(props.taskId));
  const doneCount = createMemo(() => children().filter((item) => item.completedAt !== null).length);
  const progressPercent = () =>
    children().length === 0 ? 0 : Math.round((doneCount() / children().length) * 100);

  // Same one-pass derivation as the list rows: one index and one completion set
  // per render pass, then a per-row question. A child whose prerequisite is
  // unfinished wears the compact 阻塞中 badge — its prerequisites are ordinary
  // dependency edges now, managed in the child's own detail.
  const index = createMemo(() => buildIndex(tasksState.dependencies, liveSet(tasksState.tasks)));
  const done = createMemo(() => completionSet(tasksState.tasks));
  const blocked = (child: Task) =>
    child.completedAt === null && isBlocked(index(), done(), child.id);

  const [newTitle, setNewTitle] = createSignal("");
  const [adding, setAdding] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal("");

  async function add(): Promise<void> {
    const title = newTitle().trim();
    if (!title || adding()) return;
    setAdding(true);
    const created = await createTask({ title, parentTaskId: props.taskId });
    if (created) setNewTitle("");
    setAdding(false);
  }

  function startEdit(child: Task): void {
    setEditingId(child.id);
    setEditValue(child.title);
  }

  /** Commits the inline edit; empty input cancels, unchanged skips the IPC. */
  function commitEdit(childId: string): void {
    if (editingId() !== childId) return;
    const title = editValue().trim();
    setEditingId(null);
    if (!title) return;
    const current = childrenOf(props.taskId).find((item) => item.id === childId);
    if (current && title !== current.title) {
      void updateTask(childId, { title });
    }
  }

  function move(childId: string, direction: -1 | 1): void {
    const list = children();
    const index = list.findIndex((item) => item.id === childId);
    const target = index + direction;
    if (index === -1 || target < 0 || target >= list.length) return;
    const prev =
      direction === -1
        ? target > 0
          ? list[target - 1].sortOrder
          : null
        : list[target].sortOrder;
    const next =
      direction === -1
        ? list[target].sortOrder
        : target + 1 < list.length
          ? list[target + 1].sortOrder
          : null;
    void reorderTask(childId, prev, next);
  }

  return (
    <section aria-label="子任务">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-foreground">子任务</h3>
        <Show when={children().length > 0}>
          <span class="text-xs text-muted-foreground">
            {doneCount()}/{children().length} 已完成
          </span>
        </Show>
      </div>
      <Show when={children().length > 0}>
        <div
          class="mt-1.5 h-1 rounded-full bg-surface-hover"
          role="progressbar"
          aria-label="子任务完成进度"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPercent()}
        >
          <div
            class="h-full w-full origin-left rounded-full bg-primary transition-transform duration-300 ease-out"
            style={{ transform: `scaleX(${progressPercent() / 100})` }}
          />
        </div>
      </Show>

      <ul class="mt-2 flex flex-col">
        <For each={children()}>
          {(child, index) => (
            <li class="flex flex-col" data-subtask-id={child.id}>
              <div class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover">
                <Checkbox.Root
                  checked={child.completedAt !== null}
                  onChange={(checked) =>
                    void (checked ? completeTask(child.id) : uncompleteTask(child.id))
                  }
                >
                  <Checkbox.Input
                    aria-label={
                      child.completedAt !== null
                        ? `恢复子任务 ${child.title}`
                        : `完成子任务 ${child.title}`
                    }
                  />
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                </Checkbox.Root>

                <Show
                  when={editingId() === child.id}
                  fallback={
                    <button
                      type="button"
                      class="min-w-0 flex-1 truncate text-left text-sm focus-ring"
                      title={child.title}
                      onClick={() => props.onOpenDetail(child)}
                    >
                      <span
                        classList={{ "text-subtle-foreground line-through": child.completedAt !== null }}
                      >
                        {child.title}
                      </span>
                    </button>
                  }
                >
                  <input
                    class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus-ring"
                    value={editValue()}
                    onInput={(event) => setEditValue(event.currentTarget.value)}
                    onBlur={() => commitEdit(child.id)}
                    onKeyDown={(event) => {
                      // Enter during IME composition belongs to the IME, not to us.
                      if (event.key === "Enter" && !event.isComposing) commitEdit(child.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                  />
                </Show>

                {/* Priority rides a Badge variant, never extra colour classes:
                    Tailwind resolves same-property conflicts by source order. */}
                <Show when={PRIORITY_BADGES[child.priority]}>
                  {(badge) => (
                    <Badge variant={badge().variant} size="sm">
                      {badge().label}
                    </Badge>
                  )}
                </Show>
                <Show when={child.dueAt}>
                  <Badge
                    variant={isOverdue(child.dueAt, new Date()) ? "danger" : "outline"}
                    size="sm"
                  >
                    {formatDueLabel(child.dueAt, new Date())}
                  </Badge>
                </Show>
                <Show when={blocked(child)}>
                  <Badge variant="warning" size="sm" title="前置子任务未完成">
                    阻塞中
                  </Badge>
                </Show>

                <button
                  type="button"
                  class={iconButtonClass}
                  aria-label={`上移子任务 ${child.title}`}
                  disabled={index() === 0}
                  onClick={() => move(child.id, -1)}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class={iconButtonClass}
                  aria-label={`下移子任务 ${child.title}`}
                  disabled={index() === children().length - 1}
                  onClick={() => move(child.id, 1)}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class={iconButtonClass}
                  aria-label={`重命名子任务 ${child.title}`}
                  onClick={() => startEdit(child)}
                >
                  <Pencil size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class={iconButtonClass}
                  aria-label={`编辑子任务 ${child.title}`}
                  onClick={() => props.onEdit(child)}
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class={iconButtonClass}
                  aria-label={`删除子任务 ${child.title}`}
                  onClick={() => void softDeleteTask(child.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </li>
          )}
        </For>
      </ul>

      <input
        type="text"
        aria-label="添加子任务"
        placeholder="添加子任务，回车确认"
        class="mt-2 h-8 w-full rounded-md border border-border bg-surface px-2.5 text-sm text-foreground transition duration-150 ease-out placeholder:text-subtle-foreground hover:border-border-strong focus-ring"
        value={newTitle()}
        onInput={(event) => setNewTitle(event.currentTarget.value)}
        onKeyDown={(event) => {
          // Enter during IME composition belongs to the IME, not to us.
          if (event.key === "Enter" && !event.isComposing) void add();
        }}
      />
    </section>
  );
}

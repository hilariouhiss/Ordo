import { For, Show, createMemo, createSignal } from "solid-js";
import { ChevronDown, ChevronUp, SlidersHorizontal, Trash2 } from "lucide-solid";
import { Badge, Checkbox, iconButtonClass } from "../../../common/components";
import {
  completeSubtask,
  createSubtask,
  deleteSubtask,
  reorderSubtask,
  updateSubtask,
} from "../hooks";
import { getSubtasks, tasksState } from "../store";
import type { Subtask } from "../types";
import { buildIndex, completionSet, isBlocked, liveSet } from "../dependencies";
import { formatDueLabel, isOverdue } from "../view-filters";
import { PRIORITY_BADGES } from "./TaskItemRow";
import { SubtaskEditor } from "./SubtaskEditor";

export interface SubtaskListProps {
  taskId: string;
}

/**
 * One task's subtask list (T-06): add via the input, inline-edit by clicking
 * the title, check to complete, delete, and reorder with the up/down buttons.
 * Reordering passes the neighbours' sort keys around the target slot
 * (plan §3); the hook optimistically applies the move and reconciles with
 * the authoritative list.
 *
 * The sliders button unfolds one subtask's attribute panel in place
 * (`SubtaskEditor`); the title row then wears the priority and due-date badges
 * those attributes produce. Only one panel is open at a time.
 */
export function SubtaskList(props: SubtaskListProps) {
  const subtasks = createMemo(() => getSubtasks(props.taskId));
  const doneCount = createMemo(() => subtasks().filter((item) => item.done).length);
  const progressPercent = () =>
    subtasks().length === 0 ? 0 : Math.round((doneCount() / subtasks().length) * 100);

  // Same one-pass derivation as the list rows: one index and one completion set
  // per render pass, then a per-row question. A subtask whose prerequisite is
  // unfinished wears the compact 阻塞中 badge — this dialog is the only place a
  // subtask prerequisite can be created, so it is exactly where the marker has
  // to appear next to the priority and due-date badges.
  const index = createMemo(() =>
    buildIndex(tasksState.dependencies, liveSet(tasksState.tasks, tasksState.subtasksByTask)),
  );
  const done = createMemo(() => completionSet(tasksState.tasks, tasksState.subtasksByTask));
  const blocked = (subtask: Subtask) =>
    !subtask.done && isBlocked(index(), done(), "subtask", subtask.id);

  const [newTitle, setNewTitle] = createSignal("");
  const [adding, setAdding] = createSignal(false);
  const [editingId, setEditingId] = createSignal<string | null>(null);
  const [editValue, setEditValue] = createSignal("");
  /** The subtask whose inline attribute panel is open, if any. */
  const [propertyId, setPropertyId] = createSignal<string | null>(null);

  async function add(): Promise<void> {
    const title = newTitle().trim();
    if (!title || adding()) return;
    setAdding(true);
    const created = await createSubtask(props.taskId, { title });
    if (created) setNewTitle("");
    setAdding(false);
  }

  function startEdit(subtask: Subtask): void {
    setEditingId(subtask.id);
    setEditValue(subtask.title);
  }

  /** Commits the inline edit; empty input cancels, unchanged skips the IPC. */
  function commitEdit(subtaskId: string): void {
    if (editingId() !== subtaskId) return;
    const title = editValue().trim();
    setEditingId(null);
    if (!title) return;
    const current = getSubtasks(props.taskId).find((item) => item.id === subtaskId);
    if (current && title !== current.title) {
      void updateSubtask(props.taskId, subtaskId, { title });
    }
  }

  function move(subtaskId: string, direction: -1 | 1): void {
    const list = subtasks();
    const index = list.findIndex((item) => item.id === subtaskId);
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
    void reorderSubtask(props.taskId, subtaskId, prev, next);
  }

  return (
    <section aria-label="子任务">
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-medium text-foreground">子任务</h3>
        <Show when={subtasks().length > 0}>
          <span class="text-xs text-muted-foreground">
            {doneCount()}/{subtasks().length} 已完成
          </span>
        </Show>
      </div>
      <Show when={subtasks().length > 0}>
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
        <For each={subtasks()}>
          {(subtask, index) => (
            <li class="flex flex-col" data-subtask-id={subtask.id}>
              <div class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-surface-hover">
                <Checkbox.Root
                  checked={subtask.done}
                  onChange={(done) => void completeSubtask(props.taskId, subtask.id, done)}
                >
                  <Checkbox.Input
                    aria-label={
                      subtask.done ? `恢复子任务 ${subtask.title}` : `完成子任务 ${subtask.title}`
                    }
                  />
                  <Checkbox.Control>
                    <Checkbox.Indicator />
                  </Checkbox.Control>
                </Checkbox.Root>

                <Show
                  when={editingId() === subtask.id}
                  fallback={
                    <button
                      type="button"
                      class="min-w-0 flex-1 truncate text-left text-sm focus-ring"
                      title={subtask.title}
                      onClick={() => startEdit(subtask)}
                    >
                      <span classList={{ "text-subtle-foreground line-through": subtask.done }}>
                        {subtask.title}
                      </span>
                    </button>
                  }
                >
                  <input
                    class="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm text-foreground focus-ring"
                    value={editValue()}
                    onInput={(event) => setEditValue(event.currentTarget.value)}
                    onBlur={() => commitEdit(subtask.id)}
                    onKeyDown={(event) => {
                      // Enter during IME composition belongs to the IME, not to us.
                      if (event.key === "Enter" && !event.isComposing) commitEdit(subtask.id);
                      if (event.key === "Escape") setEditingId(null);
                    }}
                  />
                </Show>

                {/* Priority rides a Badge variant, never extra colour classes:
                    Tailwind resolves same-property conflicts by source order. */}
                <Show when={PRIORITY_BADGES[subtask.priority]}>
                  {(badge) => (
                    <Badge variant={badge().variant} size="sm">
                      {badge().label}
                    </Badge>
                  )}
                </Show>
                <Show when={subtask.dueAt}>
                  <Badge
                    variant={isOverdue(subtask.dueAt, new Date()) ? "danger" : "outline"}
                    size="sm"
                  >
                    {formatDueLabel(subtask.dueAt, new Date())}
                  </Badge>
                </Show>
                <Show when={blocked(subtask)}>
                  <Badge variant="warning" size="sm" title="前置子任务未完成">
                    阻塞中
                  </Badge>
                </Show>

                <button
                  type="button"
                  class={iconButtonClass}
                  aria-label={`上移子任务 ${subtask.title}`}
                  disabled={index() === 0}
                  onClick={() => move(subtask.id, -1)}
                >
                  <ChevronUp size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class={iconButtonClass}
                  aria-label={`下移子任务 ${subtask.title}`}
                  disabled={index() === subtasks().length - 1}
                  onClick={() => move(subtask.id, 1)}
                >
                  <ChevronDown size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class={iconButtonClass}
                  aria-label={`${propertyId() === subtask.id ? "收起" : "展开"}子任务属性 ${subtask.title}`}
                  aria-expanded={propertyId() === subtask.id}
                  onClick={() =>
                    setPropertyId((current) => (current === subtask.id ? null : subtask.id))
                  }
                >
                  <SlidersHorizontal size={14} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class={iconButtonClass}
                  aria-label={`删除子任务 ${subtask.title}`}
                  onClick={() => void deleteSubtask(props.taskId, subtask.id)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>

              <Show when={propertyId() === subtask.id}>
                <SubtaskEditor
                  taskId={props.taskId}
                  subtask={subtask}
                  onClose={() => setPropertyId(null)}
                />
              </Show>
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

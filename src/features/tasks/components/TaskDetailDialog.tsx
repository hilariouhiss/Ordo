import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { Repeat } from "lucide-solid";
import { Badge, Button, Dialog } from "../../../common/components";
import { completeTask, loadSubtasks, softDeleteTask, uncompleteTask } from "../hooks";
import { describeRepeatRule } from "../repeat";
import { getTag, getTask, hasSubtasks } from "../store";
import type { Task } from "../types";
import { formatDueLabel, isOverdue } from "../view-filters";
import { PRIORITY_BADGES } from "./TaskItemRow";
import { SubtaskList } from "./SubtaskList";
import { CommentList } from "./CommentList";
import { TimeTracker } from "./TimeTracker";
import { loadComments, loadTimeEntries } from "../hooks";
import { hasComments, hasTimeEntries } from "../store";

export interface TaskDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Snapshot of the task to open; live fields are re-read from the store. */
  task: Task;
  /** Requests opening the editor for this task (the detail closes itself). */
  onEdit: (task: Task) => void;
}

/**
 * Read-only task detail (T-06): shows the task's fields and hosts its
 * subtask list. Mutations run through the optimistic hooks, so completing a
 * subtask or the task itself reflects here immediately.
 */
export function TaskDetailDialog(props: TaskDetailDialogProps) {
  // Prefer the live store row so optimistic patches update the dialog; fall
  // back to the opening snapshot (e.g. a still-in-flight optimistic task).
  const task = createMemo(() => getTask(props.task.id) ?? props.task);
  const completed = () => task().completedAt !== null;
  const priority = () => PRIORITY_BADGES[task().priority];
  const [now] = createSignal(new Date());

  createEffect(
    on(
      () => [props.open, props.task.id] as const,
      ([open, id]) => {
        if (!open) return;
        if (!hasSubtasks(id)) void loadSubtasks(id);
        if (!hasComments(id)) void loadComments(id);
        if (!hasTimeEntries(id)) void loadTimeEntries(id);
      },
    ),
  );

  function remove(): void {
    props.onOpenChange(false);
    void softDeleteTask(task().id);
  }

  function toggleComplete(): void {
    void (completed() ? uncompleteTask(task().id) : completeTask(task().id));
  }

  return (
    <Dialog.Root open={props.open} onOpenChange={props.onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content
          aria-labelledby="task-detail-title"
          class="max-h-[85vh] max-w-lg overflow-y-auto"
        >
          <Dialog.Title id="task-detail-title">
            <span classList={{ "text-subtle-foreground line-through": completed() }}>
              {task().title}
            </span>
          </Dialog.Title>
          <Dialog.Description>任务详情与子任务</Dialog.Description>
          <Dialog.CloseButton aria-label="关闭" />

          <div class="mt-4 flex flex-wrap items-center gap-2">
            <Show when={priority()}>
              {(badge) => (
                <Badge size="sm" class={badge().class}>
                  {badge().label}
                </Badge>
              )}
            </Show>
            <Show when={task().repeatRule}>
              {(rule) => (
                <Badge
                  size="sm"
                  variant="outline"
                  class={`shrink-0 ${rule().paused ? "opacity-60" : ""}`}
                >
                  <Repeat size={11} aria-hidden="true" />
                  {describeRepeatRule(rule())}
                </Badge>
              )}
            </Show>
            <Show when={task().dueAt}>
              <Badge
                size="sm"
                variant="outline"
                class={`shrink-0 ${isOverdue(task().dueAt, now()) ? "border-danger/40 text-danger" : ""}`}
              >
                {formatDueLabel(task().dueAt, now())}
              </Badge>
            </Show>
            <For each={task().tagIds}>
              {(tagId) => (
                <Show when={getTag(tagId)}>
                  {(tag) => (
                    <Badge size="sm" variant="outline">
                      <span
                        class="size-1.5 rounded-full"
                        style={{ "background-color": tag().color ?? "var(--muted-foreground)" }}
                      />
                      {tag().name}
                    </Badge>
                  )}
                </Show>
              )}
            </For>
          </div>

          <Show when={task().note}>
            <p class="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{task().note}</p>
          </Show>

          <div class="mt-4 border-t border-border pt-4">
            <Show
              when={hasSubtasks(task().id)}
              fallback={
                <p role="status" class="py-4 text-center text-sm text-muted-foreground">
                  子任务加载中…
                </p>
              }
            >
              <SubtaskList taskId={task().id} />
            </Show>
          </div>

          <div class="mt-4 border-t border-border pt-4">
            <Show
              when={hasComments(task().id)}
              fallback={
                <p role="status" class="py-4 text-center text-sm text-muted-foreground">
                  评论加载中…
                </p>
              }
            >
              <CommentList taskId={task().id} />
            </Show>
          </div>

          <div class="mt-4 border-t border-border pt-4">
            <Show
              when={hasTimeEntries(task().id)}
              fallback={
                <p role="status" class="py-4 text-center text-sm text-muted-foreground">
                  时间记录加载中…
                </p>
              }
            >
              <TimeTracker taskId={task().id} />
            </Show>
          </div>

          <div class="mt-5 flex justify-end gap-2">
            <Button variant="ghost" class="text-danger hover:bg-danger/10" onClick={remove}>
              删除
            </Button>
            <Button variant="secondary" onClick={() => props.onEdit(task())}>
              编辑
            </Button>
            <Button onClick={toggleComplete}>{completed() ? "恢复为待办" : "完成"}</Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

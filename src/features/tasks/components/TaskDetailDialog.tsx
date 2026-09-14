import { For, Show, createEffect, createMemo, createSignal, on } from "solid-js";
import { Repeat } from "lucide-solid";
import { Badge, Button, Dialog, Skeleton } from "../../../common/components";
import { completeTask, loadSubtasks, softDeleteTask, uncompleteTask } from "../hooks";
import { complexityLabel } from "../complexity";
import { describeRepeatRule } from "../repeat";
import { getTag, getTask, hasSubtasks } from "../store";
import type { Task } from "../types";
import { formatDueLabel, isOverdue } from "../view-filters";
import { PRIORITY_BADGES } from "./TaskItemRow";
import { SubtaskList } from "./SubtaskList";
import { TaskDependencies } from "./TaskDependencies";
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
 * Placeholder for a lazily-loaded section, shaped like the rows that are
 * coming so the dialog keeps its final height instead of growing when the data
 * lands.
 *
 * The bars carry no text, so the single `role="status"` region's `textContent`
 * is exactly the loading label — which is also the only thing screen readers
 * announce.
 */
function SectionLoading(props: { label: string }) {
  return (
    <div role="status" class="py-2.5">
      <span class="sr-only">{props.label}</span>
      <div aria-hidden="true" class="flex flex-col gap-2.5">
        <Skeleton class="h-3.5 w-3/5" />
        <Skeleton class="h-3.5 w-2/5" />
        <Skeleton class="h-3.5 w-1/2" />
      </div>
    </div>
  );
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
        <Dialog.Content aria-labelledby="task-detail-title" class="max-w-xl">
          <Dialog.Title id="task-detail-title">
            <span classList={{ "text-subtle-foreground line-through": completed() }}>
              {task().title}
            </span>
          </Dialog.Title>
          <Dialog.Description>任务详情与子任务</Dialog.Description>
          <Dialog.CloseButton aria-label="关闭" />

          <div class="mt-3.5 flex flex-wrap items-center gap-1.5">
            <Show when={priority()}>
              {(badge) => <Badge variant={badge().variant}>{badge().label}</Badge>}
            </Show>
            <Show when={complexityLabel(task().complexity)}>
              {(label) => <Badge variant="outline">{label()}</Badge>}
            </Show>
            <Show when={task().repeatRule}>
              {(rule) => (
                <Badge variant="outline" class={rule().paused ? "opacity-60" : ""}>
                  <Repeat size={11} aria-hidden="true" />
                  {describeRepeatRule(rule())}
                </Badge>
              )}
            </Show>
            <Show when={task().dueAt}>
              <Badge variant={isOverdue(task().dueAt, now()) ? "danger" : "outline"}>
                {formatDueLabel(task().dueAt, now())}
              </Badge>
            </Show>
            <For each={task().tagIds}>
              {(tagId) => (
                <Show when={getTag(tagId)}>
                  {(tag) => (
                    <Badge variant="outline">
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
            <p class="mt-3.5 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {task().note}
            </p>
          </Show>

          <div class="mt-5 border-t border-border pt-5">
            <TaskDependencies taskId={task().id} />
          </div>

          <div class="mt-5 border-t border-border pt-5">
            <Show
              when={hasSubtasks(task().id)}
              fallback={<SectionLoading label="子任务加载中…" />}
            >
              <SubtaskList taskId={task().id} />
            </Show>
          </div>

          <div class="mt-5 border-t border-border pt-5">
            <Show when={hasComments(task().id)} fallback={<SectionLoading label="评论加载中…" />}>
              <CommentList taskId={task().id} />
            </Show>
          </div>

          <div class="mt-5 border-t border-border pt-5">
            <Show
              when={hasTimeEntries(task().id)}
              fallback={<SectionLoading label="时间记录加载中…" />}
            >
              <TimeTracker taskId={task().id} />
            </Show>
          </div>

          <div class="mt-6 flex items-center justify-end gap-2 border-t border-border pt-4">
            <Button variant="destructive-ghost" onClick={remove}>
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

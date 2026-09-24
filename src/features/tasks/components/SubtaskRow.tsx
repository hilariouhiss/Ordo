import { Show } from "solid-js";
import { Badge, Checkbox } from "../../../common/components";
import { beginDrag, endDrag } from "../../../common/stores/drag";
import { formatDueLabel, isOverdue } from "../view-filters";
import type { Task } from "../types";
import { PRIORITY_BADGES } from "./TaskItemRow";
import { TaskTimerButton } from "./TaskTimerButton";
export interface SubtaskRowProps {
  task: Task;
  /** The parent's title, set only when this child stands on its own because its
   * parent is not in the current view; it then carries a 父任务 prefix that
   * navigates up. A child riding under its parent row passes `null`. */
  parentTitle?: string | null;
  /** The host's clock, so a child's due badge reads the same instant as the
   * rows around it (QA-02: reading `new Date()` in a row froze at creation). */
  now: Date;
  /** Whether an unfinished prerequisite is holding this child back. */
  blocked: boolean;
  /** Play the row's entry animation with this stagger, in ms (`0` included);
   * `null` (the default) for a row that was already on screen — a scroll that
   * re-mounts it must not re-run the animation. */
  enterDelay?: number | null;
  onToggleDone: (task: Task, done: boolean) => void;
  /** A child is a task with its own detail (R7c), so the title opens *that*,
   * not the parent's. */
  onOpenDetail: (task: Task) => void;
  onOpenParent?: (parentId: string) => void;
}

/**
 * One child task under an expanded parent row, or standing in for it when the
 * parent is out of view (rule A).
 *
 * Two lines like `TaskItemRow` — title with its controls, attributes as badges
 * underneath. Height (`h-18`) and 20px gutter match that row; the contract is
 * pinned in `task-views.test.tsx`. The checkboxes of the two rows only line up
 * as a column because both reserve that slot on the left, and the slot is
 * `w-5 self-stretch`, not `size-5`: `size-5` also fixes the height, and under
 * the row's `items-center` that clamps the rail to a 20px tick with a 52px
 * break between rows instead of a continuous guide. Once the checkboxes
 * align, that guide line is what makes the nesting readable.
 *
 * This is the row-shaped form of the app-wide child indent (R1): 20px step,
 * guide on the mid-line, `border-strong` for the line — the same rule the
 * sidebar groups get from the `child-indent` utility in `index.css`.
 */
export function SubtaskRow(props: SubtaskRowProps) {
  const completed = () => props.task.completedAt !== null;
  const priority = () => PRIORITY_BADGES[props.task.priority];

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole card/row IS the drag source (native Drag API); its keyboard path is the buttons inside it
    <div
      class="group flex h-18 items-center gap-2.5 border-b border-border pl-3.5 pr-2 transition-colors duration-150 hover:bg-surface-hover/60"
      classList={{ "animate-row-in": props.enterDelay !== null }}
      style={
        props.enterDelay ? { "animation-delay": `${props.enterDelay}ms` } : undefined
      }
      data-subtask-id={props.task.id}
      // R7b/§9.4: a child is a task, so it is a drag source like any other row
      // — dragging it onto a sidebar project row moves it into that project and
      // out of its parent. It is not a drop target: a child may not take a
      // parent of its own (one level, §7.5).
      draggable={true}
      onDragStart={(event) => beginDrag(event, { kind: "task", id: props.task.id })}
      onDragEnd={endDrag}
    >
      <span aria-hidden="true" class="flex w-5 shrink-0 self-stretch justify-center">
        <span class="w-px bg-border-strong" />
      </span>

      <Checkbox.Root
        checked={completed()}
        onChange={(done) => props.onToggleDone(props.task, done)}
      >
        <Checkbox.Input
          aria-label={completed() ? `恢复子任务 ${props.task.title}` : `完成子任务 ${props.task.title}`}
        />
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
      </Checkbox.Root>

      {/* Title and attributes share this column, so the second line starts
          exactly under the title. The 父任务 prefix sits *after* the rail and
          the checkbox, not before them: the rail's 20px column is what keeps
          this row's checkbox in line with every other row's, and a prefix ahead
          of it pushes the checkbox out of that column — the whole point of
          reserving the slot. */}
      <div class="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
        <div class="flex min-w-0 items-center gap-2">
          <Show when={props.parentTitle}>
            {(title) => (
              <button
                type="button"
                class="min-w-0 shrink-0 truncate rounded-sm text-xs text-subtle-foreground transition-colors hover:text-primary focus-ring"
                title={`父任务：${title()}`}
                aria-label={`打开父任务 ${title()}`}
                onClick={() => props.onOpenParent?.(props.task.parentTaskId as string)}
              >
                父任务 · {title()}
              </button>
            )}
          </Show>

          <button
            type="button"
            class="min-w-0 flex-1 truncate rounded-sm text-left text-sm text-muted-foreground transition-colors hover:text-primary focus-ring"
            title={props.task.title}
            onClick={() => props.onOpenDetail(props.task)}
          >
            <span classList={{ "text-subtle-foreground line-through": completed() }}>
              {props.task.title}
            </span>
          </button>
        </div>

        <div class="flex min-w-0 items-center gap-1.5 overflow-hidden">
          <Show when={priority()}>
            {(badge) => <Badge variant={badge().variant}>{badge().label}</Badge>}
          </Show>

          <Show when={props.task.dueAt}>
            <Badge variant={isOverdue(props.task.dueAt, props.now) ? "danger" : "outline"}>
              {formatDueLabel(props.task.dueAt, props.now)}
            </Badge>
          </Show>

          <Show when={props.blocked}>
            <Badge variant="warning" title="前置子任务未完成">
              阻塞中
            </Badge>
          </Show>
        </div>
      </div>

      <TaskTimerButton taskId={props.task.id} title={props.task.title} />
    </div>
  );
}

import { Show } from "solid-js";
import { Badge, Checkbox } from "../../../common/components";
import type { Subtask, Task } from "../types";

export interface SubtaskRowProps {
  subtask: Subtask;
  /** The parent task. Clicking the title opens *its* detail — a subtask has
   * no detail view of its own; it is edited from inside the parent's. */
  parent: Task;
  /** Whether an unfinished prerequisite is holding this subtask back. */
  blocked: boolean;
  onToggleDone: (parent: Task, subtask: Subtask, done: boolean) => void;
  onOpenDetail: (parent: Task) => void;
}

/**
 * One subtask under an expanded task row.
 *
 * Height and 20px gutter match `TaskItemRow`; that contract is pinned in
 * `task-views.test.tsx`. The checkboxes of the two rows only line up as a
 * column because both reserve that slot on the left, and the slot is
 * `w-5 self-stretch`, not `size-5`: `size-5` also fixes the height, and under
 * the row's `items-center` that clamps the rail to a 20px tick with a 36px
 * break between rows instead of a continuous guide. Once the checkboxes
 * align, that guide line is what makes the nesting readable.
 *
 * This is the row-shaped form of the app-wide child indent (R1): 20px step,
 * guide on the mid-line, `border-strong` for the line — the same rule the
 * sidebar groups get from the `child-indent` utility in `index.css`.
 */
export function SubtaskRow(props: SubtaskRowProps) {
  return (
    <div
      class="flex h-14 items-center gap-2.5 border-b border-border pl-3.5 pr-2 transition-colors duration-100 hover:bg-surface-hover/60"
      data-subtask-id={props.subtask.id}
    >
      <span aria-hidden="true" class="flex w-5 shrink-0 self-stretch justify-center">
        <span class="w-px bg-border-strong" />
      </span>

      <Checkbox.Root
        checked={props.subtask.done}
        onChange={(done) => props.onToggleDone(props.parent, props.subtask, done)}
      >
        <Checkbox.Input
          aria-label={
            props.subtask.done
              ? `恢复子任务 ${props.subtask.title}`
              : `完成子任务 ${props.subtask.title}`
          }
        />
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
      </Checkbox.Root>

      <button
        type="button"
        class="min-w-0 flex-1 truncate rounded-sm text-left text-sm text-muted-foreground transition-colors hover:text-primary focus-ring"
        title={props.subtask.title}
        onClick={() => props.onOpenDetail(props.parent)}
      >
        <span classList={{ "text-subtle-foreground line-through": props.subtask.done }}>
          {props.subtask.title}
        </span>
      </button>

      <Show when={props.blocked}>
        <Badge variant="warning" size="sm" title="前置子任务未完成">
          阻塞中
        </Badge>
      </Show>
    </div>
  );
}

import { Checkbox } from "../../../common/components";
import type { Subtask, Task } from "../types";

export interface SubtaskRowProps {
  subtask: Subtask;
  /** The parent task. Clicking the title opens *its* detail — a subtask has
   * no detail view of its own; it is edited from inside the parent's. */
  parent: Task;
  onToggleDone: (parent: Task, subtask: Subtask, done: boolean) => void;
  onOpenDetail: (parent: Task) => void;
}

/**
 * One subtask under an expanded task row.
 *
 * Height and horizontal rhythm match `TaskItemRow` exactly — the virtualizer
 * is fixed-height, and the two rows' checkboxes only line up as a column if
 * both reserve the same 20px disclosure slot on the left. The guide line in
 * that slot is what makes the nesting readable once the checkboxes align.
 * The slot is `w-5 self-stretch`, not `size-5`: `size-5` also fixes the
 * height, and under the row's `items-center` that clamps the rail to a 20px
 * tick with a 36px break between rows instead of a continuous guide.
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
    </div>
  );
}

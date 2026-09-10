import { Show } from "solid-js";
import { Badge, Checkbox } from "../../../common/components";
import { getTag } from "../../tasks/store";
import type { Task } from "../../tasks/types";
import { formatDueLabel, isOverdue } from "../../tasks/view-filters";
import { PRIORITY_BADGES } from "../../tasks/components/TaskItemRow";

export interface BoardCardProps {
  task: Task;
  /** Current clock, passed in so day boundaries stay stable per board render. */
  now: Date;
  dragging: () => boolean;
  onDragStart: (task: Task) => void;
  onDragEnd: () => void;
  onToggleComplete: (task: Task) => void;
  /** Clicking the title opens the task detail (subtasks live there). */
  onOpenDetail: (task: Task) => void;
}

/**
 * One task card on the board (P-05). Dragging uses the native Drag API; the
 * card never changes layout mid-drag — it only fades while being dragged.
 */
export function BoardCard(props: BoardCardProps) {
  const completed = () => props.task.completedAt !== null;
  const priority = () => PRIORITY_BADGES[props.task.priority];

  return (
    <div
      draggable={true}
      data-task-id={props.task.id}
      onDragStart={(event) => {
        // jsdom dispatches drag events without a real dataTransfer.
        event.dataTransfer?.setData("text/plain", props.task.id);
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
        props.onDragStart(props.task);
      }}
      onDragEnd={() => props.onDragEnd()}
      class="cursor-grab rounded-md border border-border bg-elevated p-3 shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing motion-reduce:transition-none"
      classList={{ "opacity-50": props.dragging() }}
    >
      <div class="flex items-start gap-2">
        <Checkbox.Root checked={completed()} onChange={() => props.onToggleComplete(props.task)}>
          <Checkbox.Input
            aria-label={completed() ? `恢复 ${props.task.title}` : `完成 ${props.task.title}`}
          />
          <Checkbox.Control>
            <Checkbox.Indicator />
          </Checkbox.Control>
        </Checkbox.Root>
        <button
          type="button"
          class="min-w-0 flex-1 text-left text-sm text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
          title={props.task.title}
          onClick={() => props.onOpenDetail(props.task)}
        >
          <span classList={{ "text-subtle-foreground line-through": completed() }}>
            {props.task.title}
          </span>
        </button>
      </div>

      <Show
        when={priority() || props.task.tagIds.length > 0 || props.task.dueAt}
      >
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <Show when={priority()}>
            {(badge) => (
              <Badge size="sm" class={badge().class}>
                {badge().label}
              </Badge>
            )}
          </Show>
          {props.task.tagIds.map((tagId) => {
            const tag = getTag(tagId);
            return (
              <Show when={tag}>
                {(tag) => (
                  <Badge size="sm" variant="outline">
                    <span
                      class="size-1.5 rounded-full"
                      style={{
                        "background-color": tag().color ?? "var(--muted-foreground)",
                      }}
                    />
                    {tag().name}
                  </Badge>
                )}
              </Show>
            );
          })}
          <Show when={props.task.dueAt}>
            <Badge
              size="sm"
              variant="outline"
              class={isOverdue(props.task.dueAt, props.now) ? "border-danger/40 text-danger" : ""}
            >
              {formatDueLabel(props.task.dueAt, props.now)}
            </Badge>
          </Show>
        </div>
      </Show>
    </div>
  );
}

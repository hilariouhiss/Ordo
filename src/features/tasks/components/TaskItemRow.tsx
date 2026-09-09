import { For, Show } from "solid-js";
import { MoreHorizontal, Pencil, Trash2 } from "lucide-solid";
import { Badge, Checkbox, DropdownMenu } from "../../../common/components";
import { getTag } from "../store";
import type { Priority, Task } from "../types";
import { formatDueLabel, isOverdue } from "../view-filters";

const PRIORITY_BADGES: Record<Priority, { label: string; class: string } | null> = {
  high: { label: "高", class: "bg-priority-high/10 text-priority-high" },
  medium: { label: "中", class: "bg-priority-medium/10 text-priority-medium" },
  low: { label: "低", class: "bg-priority-low/10 text-priority-low" },
  none: null,
};

export interface TaskItemRowProps {
  task: Task;
  /** Current clock, passed in so day boundaries stay stable per view render. */
  now: Date;
  onToggleComplete: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

/** One task row inside the virtualized views; height must stay 56px (ROW_HEIGHT). */
export function TaskItemRow(props: TaskItemRowProps) {
  const completed = () => props.task.completedAt !== null;
  const priority = () => PRIORITY_BADGES[props.task.priority];

  return (
    <div
      class="group flex h-14 items-center gap-3 border-b border-border pl-4 pr-2"
      data-task-id={props.task.id}
    >
      <Checkbox.Root
        checked={completed()}
        onChange={() => props.onToggleComplete(props.task)}
      >
        <Checkbox.Input
          aria-label={completed() ? `恢复 ${props.task.title}` : `完成 ${props.task.title}`}
        />
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
      </Checkbox.Root>

      <button
        type="button"
        class="min-w-0 flex-1 truncate text-left text-sm text-foreground outline-none transition-colors hover:text-primary focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        title={props.task.title}
        onClick={() => props.onEdit(props.task)}
      >
        <span classList={{ "text-subtle-foreground line-through": completed() }}>
          {props.task.title}
        </span>
      </button>

      <Show when={priority()}>
        {(badge) => (
          <Badge size="sm" class={`shrink-0 ${badge().class}`}>
            {badge().label}
          </Badge>
        )}
      </Show>

      <For each={props.task.tagIds}>
        {(tagId) => (
          <Show when={getTag(tagId)}>
            {(tag) => (
              <Badge size="sm" variant="outline" class="shrink-0">
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

      <Show when={props.task.dueAt}>
        <Badge
          size="sm"
          variant="outline"
          class={`shrink-0 ${isOverdue(props.task.dueAt, props.now) ? "border-danger/40 text-danger" : ""}`}
        >
          {formatDueLabel(props.task.dueAt, props.now)}
        </Badge>
      </Show>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`任务操作：${props.task.title}`}
          class="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground opacity-0 transition-opacity hover:bg-surface-hover hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100 motion-reduce:transition-none"
        >
          <MoreHorizontal size={16} aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={() => props.onEdit(props.task)}>
              <Pencil size={14} aria-hidden="true" />
              编辑
            </DropdownMenu.Item>
            <DropdownMenu.Item
              class="text-danger data-[highlighted]:bg-danger/10"
              onSelect={() => props.onDelete(props.task)}
            >
              <Trash2 size={14} aria-hidden="true" />
              删除
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

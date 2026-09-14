import { For, Show } from "solid-js";
import { ChevronRight, MoreHorizontal, Pencil, Repeat, Trash2 } from "lucide-solid";
import {
  Badge,
  Checkbox,
  DropdownMenu,
  iconButtonClass,
  type BadgeVariant,
} from "../../../common/components";
import { getTag } from "../store";
import { describeRepeatRule } from "../repeat";
import type { Priority, Task } from "../types";
import { formatDueLabel, isOverdue } from "../view-filters";

/*
 * Priority is expressed as a Badge *variant*, never as extra colour classes
 * passed through `class`. Tailwind resolves same-property conflicts by CSS
 * source order, and `.bg-surface-hover` is emitted after every `bg-<tone>/12`
 * tint — so a caller-supplied `bg-priority-high/12` silently lost, and the
 * 高/中/低 chips rendered as grey pills with coloured text. Picking the
 * variant makes the tone part of the base rule, where nothing can out-rank it.
 *
 * There are no `--priority-*` tokens: they held exactly the same values as
 * `--danger` / `--warning`, and 低 is a de-emphasised neutral rather than a
 * fourth hue.
 */
export const PRIORITY_BADGES: Record<Priority, { label: string; variant: BadgeVariant } | null> = {
  high: { label: "高", variant: "danger" },
  medium: { label: "中", variant: "warning" },
  low: { label: "低", variant: "default" },
  none: null,
};

export interface TaskItemRowProps {
  task: Task;
  /** Current clock, passed in so day boundaries stay stable per view render. */
  now: Date;
  /** How many subtasks the task has; 0 hides the disclosure control. */
  subtaskCount: number;
  /** How many of them are done, for the collapsed progress badge. */
  subtaskDone: number;
  expanded: boolean;
  onToggleExpand: (task: Task) => void;
  onToggleComplete: (task: Task) => void;
  /** Clicking the title opens the task detail (subtasks live there). */
  onOpenDetail: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
}

/** One task row inside the virtualized views; height must stay 56px (ROW_HEIGHT). */
export function TaskItemRow(props: TaskItemRowProps) {
  const completed = () => props.task.completedAt !== null;
  const priority = () => PRIORITY_BADGES[props.task.priority];

  return (
    <div
      // The whole row lights up on hover, not just the title: at 56px a row is
      // a large target, and highlighting all of it is what tells the eye which
      // row the trailing ⋯ button belongs to.
      class="group flex h-14 items-center gap-2.5 border-b border-border pl-3.5 pr-2 transition-colors duration-100 hover:bg-surface-hover/60"
      data-task-id={props.task.id}
    >
      <Show
        when={props.subtaskCount > 0}
        fallback={<span class="size-5 shrink-0" aria-hidden="true" />}
      >
        <button
          type="button"
          class="flex size-5 shrink-0 items-center justify-center rounded text-subtle-foreground transition duration-150 ease-out hover:bg-surface-hover hover:text-foreground focus-ring"
          aria-expanded={props.expanded}
          aria-label={`${props.expanded ? "收起" : "展开"} ${props.task.title} 的子任务`}
          onClick={() => props.onToggleExpand(props.task)}
        >
          <ChevronRight
            size={14}
            aria-hidden="true"
            class="transition-transform duration-150 ease-out"
            classList={{ "rotate-90": props.expanded }}
          />
        </button>
      </Show>

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
        class="min-w-0 flex-1 truncate rounded-sm text-left text-sm text-foreground transition-colors hover:text-primary focus-ring"
        title={props.task.title}
        onClick={() => props.onOpenDetail(props.task)}
      >
        <span classList={{ "text-subtle-foreground line-through": completed() }}>
          {props.task.title}
        </span>
      </button>

      <Show when={props.subtaskCount > 0}>
        {/* A bare `1/3` has no context read aloud; the digits stay visible. */}
        <Badge aria-label={`子任务 ${props.subtaskDone}/${props.subtaskCount} 已完成`}>
          {props.subtaskDone}/{props.subtaskCount}
        </Badge>
      </Show>

      <Show when={props.task.repeatRule}>
        {(rule) => (
          <span
            class="shrink-0 text-subtle-foreground"
            title={`重复 ${describeRepeatRule(rule())}`}
          >
            <Repeat size={13} aria-label={`重复 ${describeRepeatRule(rule())}`} />
          </span>
        )}
      </Show>

      <Show when={priority()}>
        {(badge) => <Badge variant={badge().variant}>{badge().label}</Badge>}
      </Show>

      <For each={props.task.tagIds}>
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

      <Show when={props.task.dueAt}>
        <Badge variant={isOverdue(props.task.dueAt, props.now) ? "danger" : "outline"}>
          {formatDueLabel(props.task.dueAt, props.now)}
        </Badge>
      </Show>

      <DropdownMenu.Root>
        <DropdownMenu.Trigger
          aria-label={`任务操作：${props.task.title}`}
          class={`${iconButtonClass} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
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

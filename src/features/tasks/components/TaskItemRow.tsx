import { For, Show, createSignal } from "solid-js";
import { ChevronRight, Lock, MoreHorizontal, Pencil, Repeat, Trash2 } from "lucide-solid";
import {
  Badge,
  Checkbox,
  DropdownMenu,
  iconButtonClass,
  type BadgeVariant,
} from "../../../common/components";
import { beginDrag, draggedId, endDrag } from "../../../common/stores/drag";
import { getTag } from "../store";
import { canAcceptChild } from "../hierarchy";
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
  /** Whether an unfinished prerequisite is holding this task back. */
  blocked: boolean;
  /** How many prerequisites are still unfinished. */
  blockerCount: number;
  expanded: boolean;
  /** Rule A already opened this row (`TaskListView.autoOpen`): the children are
   * on screen because the view matched one of them, not because the user asked,
   * so the row drops its disclosure control instead of offering 收起 that
   * cannot fold anything away. */
  autoExpanded: boolean;
  onToggleExpand: (task: Task) => void;
  onToggleComplete: (task: Task) => void;
  /** Clicking the title opens the task detail (subtasks live there). */
  onOpenDetail: (task: Task) => void;
  onEdit: (task: Task) => void;
  onDelete: (task: Task) => void;
  /** R7c: a task dragged onto this row becomes its child. The row refuses the
   * drops the single-level rules reject — the caller writes, the row decides. */
  onDropTask?: (draggedId: string, target: Task) => void;
}

/** One task row inside the virtualized views; its `h-14` height and 20px
 * gutter are part of the contract pinned in `task-views.test.tsx`. */
export function TaskItemRow(props: TaskItemRowProps) {
  const completed = () => props.task.completedAt !== null;
  const priority = () => PRIORITY_BADGES[props.task.priority];
  /** A legal child drop is pending over this row. */
  const [childOver, setChildOver] = createSignal(false);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole card/row IS the drag source (native Drag API); its keyboard path is the buttons inside it
    <div
      // The whole row lights up on hover, not just the title: at 56px a row is
      // a large target, and highlighting all of it is what tells the eye which
      // row the trailing ⋯ button belongs to.
      class="group flex h-14 items-center gap-2.5 border-b border-border pl-3.5 pr-2 transition-colors duration-150 hover:bg-surface-hover/60"
      data-task-id={props.task.id}
      // The drop highlight is a ring, not a border: a border would change the
      // row's box and shove the 56px rhythm the virtualizer assumes.
      classList={{ "bg-primary/10 ring-1 ring-inset ring-primary/40": childOver() }}
      // R7b: the row is the drag source for "move this task to another
      // project" — the sidebar's project rows are the drop targets. Touch
      // input already needs the platform's own long-press before a drag
      // starts, which is exactly the behaviour we want there.
      //
      // R7c: the row is also a drop target — a task dropped here is filed
      // under it, when the hierarchy rules allow that.
      draggable={true}
      onDragStart={(event) => beginDrag(event, { kind: "task", id: props.task.id })}
      onDragEnd={endDrag}
      onDragOver={(event) => {
        const dragged = draggedId(event, "task");
        if (!dragged || !props.onDropTask || !canAcceptChild(dragged, props.task)) return;
        // preventDefault is what makes this element a drop target at all.
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        setChildOver(true);
      }}
      onDragLeave={() => setChildOver(false)}
      onDrop={(event) => {
        const dragged = draggedId(event, "task");
        setChildOver(false);
        if (!dragged || !props.onDropTask || !canAcceptChild(dragged, props.task)) return;
        event.preventDefault();
        endDrag();
        props.onDropTask(dragged, props.task);
      }}
    >
      <Show
        when={props.subtaskCount > 0 && !props.autoExpanded}
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
        {/* A bare `1/3` has no context read aloud, and `aria-label` cannot give
            it one: the Badge is a generic span, and ARIA forbids naming those
            (`role=generic` has no name-from-author). So the digits are hidden
            from assistive tech and the label is real text instead. */}
        <Badge>
          <span aria-hidden="true">
            {props.subtaskDone}/{props.subtaskCount}
          </span>
          <span class="sr-only">
            子任务 {props.subtaskDone}/{props.subtaskCount} 已完成
          </span>
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

      <Show when={props.blocked}>
        {/* Same split as the progress badge above: the compact text is the
            sighted label, and the sentence behind it is what gets announced. */}
        <Badge variant="warning">
          <Lock size={11} aria-hidden="true" />
          <span aria-hidden="true">阻塞中 · 还差 {props.blockerCount} 项</span>
          <span class="sr-only">
            阻塞中，还有 {props.blockerCount} 项前置未完成
          </span>
        </Badge>
      </Show>

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

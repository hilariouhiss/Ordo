import { For, Show, createMemo } from "solid-js";
import { MoreHorizontal } from "lucide-solid";
import {
  Badge,
  Checkbox,
  DropdownMenu,
  iconButtonClass,
} from "../../../common/components";
import { childrenOf, getTag } from "../../tasks/store";
import type { Task } from "../../tasks/types";
import { formatDueLabel, isOverdue } from "../../tasks/view-filters";
import { PRIORITY_BADGES } from "../../tasks/components/TaskItemRow";
import type { BoardColumn } from "../types";

export interface BoardCardProps {
  task: Task;
  /** Current clock, passed in so day boundaries stay stable per board render. */
  now: Date;
  dragging: () => boolean;
  /** The lanes this card is *not* in: the card menu's move targets. */
  moveTargets: () => BoardColumn[];
  onDragStart: (task: Task) => void;
  onDragEnd: () => void;
  onToggleComplete: (task: Task) => void;
  /** Clicking the title opens the task detail (subtasks live there). */
  onOpenDetail: (task: Task) => void;
  /** Keyboard path for the drag gesture: move this card into `columnId`. */
  onMoveToColumn: (columnId: string) => void;
}

/**
 * One task card on the board (P-05). Dragging uses the native Drag API; the
 * card never changes layout mid-drag — it only fades while being dragged.
 *
 * The card is the top plane of the board's three (page, sunken column well,
 * elevated card), so it keeps a hairline border and earns its shadow on hover
 * rather than wearing one at rest.
 */
export function BoardCard(props: BoardCardProps) {
  const completed = () => props.task.completedAt !== null;
  const priority = () => PRIORITY_BADGES[props.task.priority];
  // §8.4: a card stays the top-level entry point for its own work, so a parent
  // shows how far its children got instead of the board listing them.
  const children = createMemo(() => childrenOf(props.task.id));
  const childDone = createMemo(
    () => children().filter((child) => child.completedAt !== null).length,
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the whole card/row IS the drag source (native Drag API); its keyboard path is the buttons inside it
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
      class="group cursor-grab rounded-lg border border-border bg-elevated p-3 transition duration-150 ease-out hover:border-border-strong hover:shadow-md focus-ring active:cursor-grabbing"
      classList={{ "opacity-40": props.dragging() }}
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
          class="min-w-0 flex-1 rounded-sm text-left text-sm text-foreground transition-colors hover:text-primary focus-ring"
          title={props.task.title}
          onClick={() => props.onOpenDetail(props.task)}
        >
          <span classList={{ "text-subtle-foreground line-through": completed() }}>
            {props.task.title}
          </span>
        </button>

        {/* The keyboard path for "drag this card to another lane": the lanes are
            the only thing a drag can say that no button could. */}
        <Show when={props.moveTargets().length > 0}>
          <DropdownMenu.Root>
            <DropdownMenu.Trigger
              aria-label={`任务操作：${props.task.title}`}
              class={`${iconButtonClass} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
            >
              <MoreHorizontal size={15} aria-hidden="true" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content>
                <DropdownMenu.Group>
                  <DropdownMenu.GroupLabel>移动到</DropdownMenu.GroupLabel>
                  <For each={props.moveTargets()}>
                    {(column) => (
                      <DropdownMenu.Item onSelect={() => props.onMoveToColumn(column.id)}>
                        移到 {column.name}
                      </DropdownMenu.Item>
                    )}
                  </For>
                </DropdownMenu.Group>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>
        </Show>
      </div>

      <Show
        when={
          children().length > 0 ||
          priority() ||
          props.task.tagIds.length > 0 ||
          props.task.dueAt
        }
      >
        <div class="mt-2.5 flex flex-wrap items-center gap-1.5">
          <Show when={children().length > 0}>
            {/* Same split as the list row's badge: the digits are the sighted
                label, the sentence behind them is what gets announced — a bare
                `0/1` has no context read aloud, and `aria-label` cannot give a
                generic span one. */}
            <Badge>
              <span aria-hidden="true">
                {childDone()}/{children().length} 个子任务
              </span>
              <span class="sr-only">
                子任务 {childDone()}/{children().length} 已完成
              </span>
            </Badge>
          </Show>
          <Show when={priority()}>
            {(badge) => <Badge variant={badge().variant}>{badge().label}</Badge>}
          </Show>
          {props.task.tagIds.map((tagId) => {
            const tag = getTag(tagId);
            return (
              <Show when={tag}>
                {(tag) => (
                  <Badge variant="outline">
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
            <Badge variant={isOverdue(props.task.dueAt, props.now) ? "danger" : "outline"}>
              {formatDueLabel(props.task.dueAt, props.now)}
            </Badge>
          </Show>
        </div>
      </Show>
    </div>
  );
}

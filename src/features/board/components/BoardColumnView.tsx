import { For, Show, createSignal } from "solid-js";
import { CheckCircle2 } from "lucide-solid";
import type { Task } from "../../tasks/types";
import type { BoardColumn } from "../types";
import { BoardCard } from "./BoardCard";

export interface BoardColumnViewProps {
  column: BoardColumn;
  /** The column's tasks, already ordered by sort key. */
  tasks: () => Task[];
  /** Current clock, passed in so day boundaries stay stable per board render. */
  now: Date;
  draggingTaskId: () => string | null;
  onDragStartTask: (task: Task) => void;
  onDragEnd: () => void;
  /** Drop handler; the board resolves the task id and sort keys. */
  onDropTask: (columnId: string, index: number) => void;
  onToggleComplete: (task: Task) => void;
  onOpenDetail: (task: Task) => void;
}

/**
 * One board column (P-05): a droppable card list with an absolutely
 * positioned insertion line. The line never shifts layout (position:absolute
 * + paint-only updates), so dragging stays transform-only at frame rate.
 *
 * The column is the project's own row, with no management controls: 待办 /
 * 进行中 / 已完成 come with the project, so the header only names the lane,
 * counts it and flags the done one.
 *
 * The column is a `bg-sunken` well with no border. That gives the board three
 * readable planes — page, well, card — which a bordered box on a nearly
 * identical background cannot: at these two lightness values a hairline was
 * doing all the work, and every column read as a plain outlined rectangle.
 */
export function BoardColumnView(props: BoardColumnViewProps) {
  // Insertion point while a card hovers over this column: index within the
  // task list plus the indicator's Y offset inside the list container.
  const [insert, setInsert] = createSignal<{ index: number; y: number } | null>(null);
  let listRef: HTMLDivElement | undefined;

  function indexFromEvent(event: DragEvent): { index: number; y: number } {
    const container = listRef;
    if (!container) return { index: props.tasks().length, y: 0 };
    const cards = Array.from(container.querySelectorAll("[data-task-id]"));
    const top = container.getBoundingClientRect().top;
    let index = cards.length;
    let y = container.scrollHeight;
    for (let i = 0; i < cards.length; i += 1) {
      const rect = cards[i].getBoundingClientRect();
      if (event.clientY < rect.top + rect.height / 2) {
        index = i;
        y = rect.top - top - 2;
        break;
      }
      y = rect.bottom - top;
    }
    return { index, y };
  }

  function handleDragOver(event: DragEvent): void {
    if (!props.draggingTaskId()) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
    setInsert(indexFromEvent(event));
  }

  function handleDrop(event: DragEvent): void {
    event.preventDefault();
    const at = indexFromEvent(event);
    setInsert(null);
    props.onDropTask(props.column.id, at.index);
  }

  return (
    <section
      aria-label={`看板列 ${props.column.name}`}
      data-column-id={props.column.id}
      class="flex w-72 shrink-0 flex-col rounded-xl bg-sunken"
    >
      <header class="flex items-center gap-1.5 px-2.5 py-2">
        <span class="min-w-0 flex-1 truncate pl-1 text-sm font-medium text-foreground">
          {props.column.name}
        </span>
        <span class="shrink-0 text-xs text-subtle-foreground">{props.tasks().length}</span>
        <Show when={props.column.isDone}>
          <CheckCircle2 size={14} class="shrink-0 text-primary" aria-label="完成列" />
        </Show>
      </header>

      <div
        ref={listRef}
        data-drop-zone={props.column.id}
        class="relative min-h-16 flex-1 overflow-y-auto p-2"
        onDragOver={handleDragOver}
        onDragLeave={(event) => {
          const next = event.relatedTarget as Node | null;
          if (!next || !listRef?.contains(next)) setInsert(null);
        }}
        onDrop={handleDrop}
      >
        <For each={props.tasks()}>
          {(task) => (
            <div class="mb-2">
              <BoardCard
                task={task}
                now={props.now}
                dragging={() => props.draggingTaskId() === task.id}
                onDragStart={props.onDragStartTask}
                onDragEnd={props.onDragEnd}
                onToggleComplete={props.onToggleComplete}
                onOpenDetail={props.onOpenDetail}
              />
            </div>
          )}
        </For>
        <Show when={props.tasks().length === 0 && !insert()}>
          <p class="rounded-lg border border-dashed border-border-strong px-2 py-4 text-center text-xs text-subtle-foreground">
            拖拽任务到这里
          </p>
        </Show>
        <Show when={insert()}>
          {(at) => (
            <div
              aria-hidden="true"
              data-drop-indicator={props.column.id}
              class="pointer-events-none absolute inset-x-2 h-0.5 rounded-full bg-primary"
              style={{ top: `${at().y}px` }}
            />
          )}
        </Show>
      </div>
    </section>
  );
}

import { For, Show, createEffect, createSignal, on } from "solid-js";
import { CircleAlert } from "lucide-solid";
import { Button, EmptyState } from "../../../common/components";
import { TaskDetailDialog } from "../../tasks/components/TaskDetailDialog";
import { completeTask, uncompleteTask } from "../../tasks/hooks";
import { tasksState } from "../../tasks/store";
import type { Task } from "../../tasks/types";
import { sortTasks } from "../../tasks/view-filters";
import { laneOf, splitLanes } from "../lanes";
import { loadColumns, moveTaskToColumn } from "../hooks";
import { getColumns, hasColumns } from "../store";
import { BoardColumnView } from "./BoardColumnView";

/**
 * Kanban board (P-05): the project's columns as droppable lanes. Cards drag via
 * the native Drag API — nothing re-renders or reflows during dragover except
 * the absolute-positioned insertion line, and one `board:moveTask` call
 * persists column + order on drop.
 *
 * Lanes are a *presentation* of the project's tasks (`../lanes`), so what the
 * list shows and what the board shows are the same tasks in the same state.
 */
export function BoardView(props: { projectId: string }) {
  const [failed, setFailed] = createSignal(false);
  const [now] = createSignal(new Date());
  const [draggingTaskId, setDraggingTaskId] = createSignal<string | null>(null);
  const [detailOpen, setDetailOpen] = createSignal(false);
  const [detailTask, setDetailTask] = createSignal<Task | null>(null);

  // Load on mount and whenever the project switches into an uncached board.
  createEffect(
    on(
      () => props.projectId,
      (projectId) => {
        setFailed(false);
        if (!hasColumns(projectId)) void retry();
      },
    ),
  );

  async function retry(): Promise<void> {
    setFailed(false);
    const ok = await loadColumns(props.projectId);
    setFailed(!ok);
  }

  const columns = () => getColumns(props.projectId);
  const lanes = () => splitLanes(columns());
  // The lane rules (`../lanes`) decide where each task shows; the board never
  // hides one. §8.4 keeps children out: a child has no `columnId` of its own —
  // it lives inside its parent, which is where its progress shows.
  const tasksOf = (columnId: string) =>
    sortTasks(
      tasksState.tasks.filter(
        (task) => task.parentTaskId === null && laneOf(task, lanes())?.id === columnId,
      ),
      "manual",
    );

  function openDetail(task: Task): void {
    setDetailTask(task);
    setDetailOpen(true);
  }

  function toggleComplete(task: Task): void {
    void (task.completedAt ? uncompleteTask(task.id) : completeTask(task.id));
  }

  function handleDrop(columnId: string, index: number): void {
    const taskId = draggingTaskId();
    setDraggingTaskId(null);
    if (!taskId) return;
    const target = tasksOf(columnId).filter((task) => task.id !== taskId);
    const prev = index > 0 ? target[index - 1].sortOrder : null;
    const next = index < target.length ? target[index].sortOrder : null;
    void moveTaskToColumn(taskId, columnId, prev, next);
  }

  return (
    <Show
      when={!failed()}
      fallback={
        <div role="alert" class="flex h-full min-h-64 flex-col">
          <EmptyState
            icon={<CircleAlert size={22} />}
            title="加载失败"
            description="看板数据没能读出来，请重试。"
            action={
              <Button variant="secondary" onClick={() => void retry()}>
                重试
              </Button>
            }
          />
        </div>
      }
    >
      <div class="h-full min-h-0 overflow-x-auto">
        <div class="flex h-full min-h-0 items-stretch gap-4 p-5">
          <For each={columns()}>
            {(column) => (
              <BoardColumnView
                column={column}
                tasks={() => tasksOf(column.id)}
                now={now()}
                draggingTaskId={draggingTaskId}
                onDragStartTask={(task) => setDraggingTaskId(task.id)}
                onDragEnd={() => setDraggingTaskId(null)}
                onDropTask={handleDrop}
                onToggleComplete={toggleComplete}
                onOpenDetail={openDetail}
              />
            )}
          </For>
        </div>
      </div>

      <Show when={detailTask()}>
        {(task) => (
          <TaskDetailDialog
            open={detailOpen()}
            onOpenChange={setDetailOpen}
            task={task()}
            onEdit={() => setDetailOpen(false)}
          />
        )}
      </Show>
    </Show>
  );
}

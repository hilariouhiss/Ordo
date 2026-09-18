import { For, Show, createEffect, createSignal, on } from "solid-js";
import { CircleAlert } from "lucide-solid";
import { Button, EmptyState } from "../../../common/components";
import { createNow } from "../../../common/clock";
import { TaskDetailDialog } from "../../tasks/components/TaskDetailDialog";
import { TaskEditorDialog } from "../../tasks/components/TaskEditorDialog";
import { completeTask, uncompleteTask } from "../../tasks/hooks";
import { scopeRows } from "../../tasks/store";
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
  const now = createNow();
  const [draggingTaskId, setDraggingTaskId] = createSignal<string | null>(null);
  const [detailOpen, setDetailOpen] = createSignal(false);
  const [detailTask, setDetailTask] = createSignal<Task | null>(null);
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingTask, setEditingTask] = createSignal<Task | null>(null);

  // The failure flag belongs to the project on screen, so a load is only
  // allowed to set it while it is still the current one (QA-03). Leaving a
  // project invalidates whatever it had in flight, whether or not the board
  // being entered needs a request of its own.
  let loadSeq = 0;

  // Load on mount and whenever the project switches into an uncached board.
  createEffect(
    on(
      () => props.projectId,
      (projectId) => {
        loadSeq += 1;
        setFailed(false);
        if (!hasColumns(projectId)) void retry();
      },
    ),
  );

  async function retry(): Promise<void> {
    const request = ++loadSeq;
    setFailed(false);
    const ok = await loadColumns(props.projectId);
    if (request !== loadSeq) return;
    setFailed(!ok);
  }

  const columns = () => getColumns(props.projectId);
  const lanes = () => splitLanes(columns());
  // The scope *is* this project, so no `projectId` filter is needed here: a task
  // outside it cannot reach this board. §8.4 keeps children out — a child can
  // carry a `columnId`, but it lives inside its parent, never on a lane.
  const tasksOf = (columnId: string) =>
    sortTasks(
      scopeRows(`project:${props.projectId}`).filter(
        (task) => task.parentTaskId === null && laneOf(task, lanes())?.id === columnId,
      ),
      "manual",
    );

  function openDetail(task: Task): void {
    setDetailTask(task);
    setDetailOpen(true);
  }

  /** The detail's 编辑 button swaps the detail for the editor, the same way the
   * app-level task viewer does — on the board it used to just close the detail. */
  function openEditFromDetail(task: Task): void {
    setEditingTask(task);
    setDetailOpen(false);
    setEditorOpen(true);
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

  /** The card menu's move: a menu item cannot name a slot the way a drop can,
   * so the card joins the end of the lane. */
  function moveToColumn(task: Task, columnId: string): void {
    const lane = tasksOf(columnId).filter((item) => item.id !== task.id);
    const prev = lane.length > 0 ? lane[lane.length - 1].sortOrder : null;
    void moveTaskToColumn(task.id, columnId, prev, null);
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
                moveTargets={() => columns().filter((item) => item.id !== column.id)}
                onDragStartTask={(task) => setDraggingTaskId(task.id)}
                onDragEnd={() => setDraggingTaskId(null)}
                onDropTask={handleDrop}
                onToggleComplete={toggleComplete}
                onOpenDetail={openDetail}
                onMoveTaskToColumn={moveToColumn}
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
            onEdit={openEditFromDetail}
          />
        )}
      </Show>

      <TaskEditorDialog
        open={editorOpen()}
        onOpenChange={setEditorOpen}
        task={editingTask() ?? undefined}
      />
    </Show>
  );
}

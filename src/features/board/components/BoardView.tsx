import { For, Show, createEffect, createSignal, on } from "solid-js";
import { CircleAlert, Plus } from "lucide-solid";
import { Button, EmptyState, TextField } from "../../../common/components";
import { TaskDetailDialog } from "../../tasks/components/TaskDetailDialog";
import { completeTask, uncompleteTask } from "../../tasks/hooks";
import { tasksState } from "../../tasks/store";
import type { Task } from "../../tasks/types";
import { sortTasks } from "../../tasks/view-filters";
import { createColumn, deleteColumn, loadColumns, moveTaskToColumn, updateColumn } from "../hooks";
import { getColumns, hasColumns } from "../store";
import { BoardColumnView } from "./BoardColumnView";

/**
 * Kanban board (P-05): the project's columns as droppable lanes plus the
 * add-column flow. Cards drag via the native Drag API — nothing re-renders
 * or reflows during dragover except the absolute-positioned insertion line,
 * and one `board:moveTask` call persists column + order on drop.
 */
export function BoardView(props: { projectId: string }) {
  const [failed, setFailed] = createSignal(false);
  const [now] = createSignal(new Date());
  const [draggingTaskId, setDraggingTaskId] = createSignal<string | null>(null);
  const [detailOpen, setDetailOpen] = createSignal(false);
  const [detailTask, setDetailTask] = createSignal<Task | null>(null);
  const [addingColumn, setAddingColumn] = createSignal(false);
  const [newColumnName, setNewColumnName] = createSignal("");

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
  const tasksOf = (columnId: string) =>
    sortTasks(
      tasksState.tasks.filter((task) => task.columnId === columnId),
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

  function handleRename(columnId: string, name: string): void {
    void updateColumn(columnId, { name });
  }

  function handleToggleDone(columnId: string, isDone: boolean): void {
    void updateColumn(columnId, { isDone });
  }

  function handleDelete(columnId: string): void {
    void deleteColumn(columnId);
  }

  function commitAddColumn(event: SubmitEvent): void {
    event.preventDefault();
    const name = newColumnName().trim();
    if (!name) return;
    void createColumn(props.projectId, name);
    setNewColumnName("");
    setAddingColumn(false);
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
                onRename={handleRename}
                onToggleDone={(column) => handleToggleDone(column.id, !column.isDone)}
                onDelete={(column) => handleDelete(column.id)}
              />
            )}
          </For>

          <Show
            when={!addingColumn()}
            fallback={
              <form
                class="flex w-72 shrink-0 flex-col gap-2 self-start rounded-xl bg-sunken p-3"
                onSubmit={commitAddColumn}
              >
                <TextField.Root value={newColumnName()} onChange={setNewColumnName}>
                  <TextField.Label>新建列</TextField.Label>
                  <TextField.Input placeholder="例如：评审" />
                </TextField.Root>
                <div class="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setAddingColumn(false)}
                  >
                    取消
                  </Button>
                  <Button type="submit" size="sm">
                    添加
                  </Button>
                </div>
              </form>
            }
          >
            <button
              type="button"
              class="flex w-72 shrink-0 items-center justify-center gap-1.5 self-start rounded-xl border border-dashed border-border-strong py-3 text-sm text-muted-foreground transition duration-150 ease-out hover:border-primary hover:text-primary focus-ring"
              onClick={() => setAddingColumn(true)}
            >
              <Plus size={15} aria-hidden="true" />
              添加列
            </button>
          </Show>
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

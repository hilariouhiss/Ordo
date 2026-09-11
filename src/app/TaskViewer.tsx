import { Show, createMemo, createSignal } from "solid-js";
import { TaskDetailDialog } from "../features/tasks/components/TaskDetailDialog";
import { TaskEditorDialog } from "../features/tasks/components/TaskEditorDialog";
import { getTask } from "../features/tasks/store";
import type { Task } from "../features/tasks/types";
import { closeTaskViewer, focusedTaskId } from "../common/stores/taskViewer";

/**
 * App-level host for the task detail/editor dialogs (search hits and other
 * cross-view entries jump here). The detail is open whenever the viewer has
 * a focus id; the 编辑 button swaps it for the editor, and any close path
 * clears the focus id so reopening the same task works.
 */
export default function TaskViewer() {
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingTask, setEditingTask] = createSignal<Task | null>(null);

  const task = createMemo(() => {
    const id = focusedTaskId();
    return id ? getTask(id) : undefined;
  });
  const detailOpen = () => focusedTaskId() !== null && !editorOpen();

  const closeDetail = (open: boolean) => {
    if (!open) closeTaskViewer();
  };

  /** The detail's 编辑 button: swap the detail dialog for the editor. */
  const openEditFromDetail = (current: Task) => {
    setEditingTask(current);
    setEditorOpen(true);
  };

  const closeEditor = (open: boolean) => {
    setEditorOpen(open);
    if (!open) closeTaskViewer();
  };

  return (
    <Show when={task()}>
      {(current) => (
        <>
          <TaskDetailDialog
            open={detailOpen()}
            onOpenChange={closeDetail}
            task={current()}
            onEdit={openEditFromDetail}
          />
          <TaskEditorDialog
            open={editorOpen()}
            onOpenChange={closeEditor}
            task={editingTask() ?? undefined}
          />
        </>
      )}
    </Show>
  );
}

import { Show, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Archive, Pencil, RotateCcw } from "lucide-solid";
import { Button, Tabs } from "../../../common/components";
import { tasksState } from "../../tasks/store";
import { SORT_OPTIONS, TaskListView } from "../../tasks/components/TaskListView";
import { BoardView } from "../../board/components/BoardView";
import { archiveProject, restoreProject } from "../hooks";
import { getProjectIcon } from "../icons";
import { getProject } from "../store";
import type { Project } from "../types";
import { ProjectEditorDialog } from "./ProjectEditorDialog";

/**
 * Project detail work area (P-04): the project's identity header with a live
 * completion rate, and its task list with manual/priority/due/tag sorting
 * plus quick completion. All data flows through the reactive task/project
 * stores, so completing a task updates the rate in the same tick.
 */
export function ProjectListView(props: { project: Project }) {
  // Prefer the live store row so optimistic patches (e.g. renames from the
  // editor) update the header immediately; fall back to the opening snapshot.
  const project = createMemo(() => getProject(props.project.id) ?? props.project);
  const tasks = createMemo(() =>
    tasksState.tasks.filter((task) => task.projectId === project().id),
  );
  const doneCount = () => tasks().filter((task) => task.completedAt !== null).length;
  const rate = () => (tasks().length === 0 ? 0 : Math.round((doneCount() / tasks().length) * 100));

  const [editorOpen, setEditorOpen] = createSignal(false);
  const [view, setView] = createSignal<"list" | "board">("list");

  return (
    <div class="flex h-full min-h-0 flex-col">
      <header class="border-b border-border px-6 py-4">
        <div class="flex items-start gap-3">
          <span
            class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-md"
            style={{
              "background-color": project().color
                ? `color-mix(in srgb, ${project().color} 15%, transparent)`
                : "var(--surface-hover)",
              color: project().color ?? "var(--muted-foreground)",
            }}
          >
            <Dynamic component={getProjectIcon(project().icon)} size={18} />
          </span>
          <div class="min-w-0 flex-1">
            <h2 class="truncate text-lg font-semibold text-foreground">{project().name}</h2>
            <Show when={project().description}>
              <p class="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                {project().description}
              </p>
            </Show>
            <Show when={project().dueAt}>
              <p class="mt-1 text-xs text-muted-foreground">
                截止：
                {format(new Date(project().dueAt as string), "yyyy年M月d日", { locale: zhCN })}
              </p>
            </Show>
          </div>
          <div class="flex shrink-0 gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditorOpen(true)}>
              <Pencil size={14} aria-hidden="true" />
              编辑
            </Button>
            <Show
              when={project().status === "archived"}
              fallback={
                <Button
                  variant="ghost"
                  size="sm"
                  class="text-muted-foreground hover:bg-surface-hover"
                  onClick={() => void archiveProject(project().id)}
                >
                  <Archive size={14} aria-hidden="true" />
                  归档
                </Button>
              }
            >
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void restoreProject(project().id)}
              >
                <RotateCcw size={14} aria-hidden="true" />
                恢复
              </Button>
            </Show>
          </div>
        </div>

        <Show when={project().status === "archived"}>
          <p
            role="status"
            class="mt-3 rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted-foreground"
          >
            该项目已归档，不再显示在侧边栏导航中；恢复后重新出现。
          </p>
        </Show>

        <div class="mt-3 flex items-center gap-3">
          <div
            class="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-hover"
            role="progressbar"
            aria-label={`完成率 ${rate()}%`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={rate()}
          >
            <div
              class="h-full w-full origin-left rounded-full bg-primary transition-transform motion-reduce:transition-none"
              style={{ transform: `scaleX(${rate() / 100})` }}
            />
          </div>
          <span class="shrink-0 text-xs text-muted-foreground" role="status">
            {doneCount()} / {tasks().length} 已完成（{rate()}%）
          </span>
        </div>
      </header>

      <Tabs.Root
        value={view()}
        onChange={(value) => setView(value as "list" | "board")}
        class="min-h-0 flex-1"
      >
        <Tabs.List class="px-6">
          <Tabs.Trigger value="list">列表</Tabs.Trigger>
          <Tabs.Trigger value="board">看板</Tabs.Trigger>
          <Tabs.Indicator />
        </Tabs.List>
        <Tabs.Content value="list" class="min-h-0 flex-1">
          <div class="h-full min-h-0">
            <TaskListView
              tasks={tasks}
              emptyTitle="项目里还没有任务"
              emptyDescription="点击右上角「新建任务」，为这个项目规划第一项工作。"
              defaultSort="manual"
              sortOptions={[
                SORT_OPTIONS.manual,
                SORT_OPTIONS.priority,
                SORT_OPTIONS.due,
                SORT_OPTIONS.tag,
              ]}
              defaultProjectId={project().id}
            />
          </div>
        </Tabs.Content>
        <Tabs.Content value="board" class="min-h-0 flex-1">
          <BoardView projectId={project().id} />
        </Tabs.Content>
      </Tabs.Root>

      <ProjectEditorDialog
        open={editorOpen()}
        onOpenChange={setEditorOpen}
        project={project()}
      />
    </div>
  );
}

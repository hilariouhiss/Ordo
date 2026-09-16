import { Show, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Archive, Pencil, RotateCcw } from "lucide-solid";
import { Button, Tabs } from "../../../common/components";
import { getIcon } from "../../../common/icons";
import { tasks as allTasks } from "../../tasks/store";
import { SORT_OPTIONS, TaskListView } from "../../tasks/components/TaskListView";
import { BoardView } from "../../board/components/BoardView";
import { archiveProject, restoreProject } from "../hooks";
import { getProject } from "../store";
import type { Project } from "../types";
import { ProjectEditorDialog } from "./ProjectEditorDialog";
import { ProjectProgress } from "./ProjectProgress";

/**
 * Project detail work area (P-04/ST-03): the project's identity header with a
 * live progress summary (bar, completion rate, remaining work and the time
 * left until the due date), and its task list with manual/priority/due/tag
 * sorting plus quick completion. All data flows through the reactive
 * task/project stores, so completing a task updates the progress in the same
 * tick.
 */
export function ProjectListView(props: { project: Project }) {
  // Prefer the live store row so optimistic patches (e.g. renames from the
  // editor) update the header immediately; fall back to the opening snapshot.
  const project = createMemo(() => getProject(props.project.id) ?? props.project);
  const tasks = createMemo(() =>
    allTasks().filter((task) => task.projectId === project().id),
  );

  const [editorOpen, setEditorOpen] = createSignal(false);
  const [view, setView] = createSignal<"list" | "board">("list");

  return (
    <div class="flex h-full min-h-0 flex-col">
      {/* No bottom border here: the tab strip directly below already draws the
          one rule this block needs. Three stacked horizontal lines (header,
          tabs, toolbar) was a third more chrome than the content required. */}
      <header class="shrink-0 px-5 pb-4 pt-5">
        <div class="flex items-start gap-3.5">
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-lg"
            style={{
              "background-color": project().color
                ? `color-mix(in srgb, ${project().color} 18%, transparent)`
                : "var(--surface-hover)",
              color: project().color ?? "var(--muted-foreground)",
            }}
          >
            <Dynamic component={getIcon(project().icon)} size={20} />
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <h2 class="truncate text-lg font-semibold tracking-tight text-foreground">
                {project().name}
              </h2>
              <Show when={project().status === "archived"}>
                <span class="shrink-0 rounded-[5px] bg-surface-hover px-1.5 py-0.5 text-2xs font-medium text-muted-foreground">
                  已归档
                </span>
              </Show>
            </div>
            <Show when={project().description}>
              <p class="mt-1 max-w-[68ch] whitespace-pre-wrap text-sm text-muted-foreground">
                {project().description}
              </p>
            </Show>
          </div>

          <div class="flex shrink-0 items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => setEditorOpen(true)}>
              <Pencil size={13} aria-hidden="true" />
              编辑
            </Button>
            <Show
              when={project().status === "archived"}
              fallback={
                <Button variant="ghost" size="sm" onClick={() => void archiveProject(project().id)}>
                  <Archive size={13} aria-hidden="true" />
                  归档
                </Button>
              }
            >
              <Button variant="secondary" size="sm" onClick={() => void restoreProject(project().id)}>
                <RotateCcw size={13} aria-hidden="true" />
                恢复
              </Button>
            </Show>
          </div>
        </div>

        <Show when={project().status === "archived"}>
          <p
            role="status"
            class="mt-3.5 rounded-md bg-warning/12 px-3 py-2 text-xs text-warning"
          >
            该项目已归档，不再显示在侧边栏导航中；恢复后重新出现。
          </p>
        </Show>

        <div class="mt-4">
          {/* §8.5: the panel counts the slice it is handed, so the
              top-level-only filter happens here — a child is a step inside its
              parent, and counting both would report the same work twice. */}
          <ProjectProgress tasks={tasks().filter((task) => task.parentTaskId === null)} />
        </div>
      </header>

      <Tabs.Root
        value={view()}
        onChange={(value) => setView(value as "list" | "board")}
        class="min-h-0 flex-1"
      >
        <Tabs.List class="shrink-0 px-5">
          <Tabs.Trigger value="list">列表</Tabs.Trigger>
          <Tabs.Trigger value="board">看板</Tabs.Trigger>
          <Tabs.Indicator />
        </Tabs.List>
        <Tabs.Content value="list" class="min-h-0 flex-1">
          <div class="h-full min-h-0">
            <TaskListView
              tasks={tasks}
              emptyTitle="项目里还没有任务"
              emptyDescription="把这项工作拆成能一项项勾掉的具体步骤，进度条就会跟着走。"
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

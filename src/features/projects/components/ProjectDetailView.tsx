import { Show, createEffect, createMemo, createSignal, on, onMount } from "solid-js";
import { Dynamic } from "solid-js/web";
import { useParams } from "@tanstack/solid-router";
import { format } from "date-fns";
import { zhCN } from "date-fns/locale";
import { Archive, Pencil, RotateCcw } from "lucide-solid";
import { Button } from "../../../common/components";
import PlaceholderView from "../../../app/PlaceholderView";
import { archiveProject, loadAll, restoreProject } from "../hooks";
import { getProjectIcon } from "../icons";
import { getProject, projectsState } from "../store";
import { ProjectEditorDialog } from "./ProjectEditorDialog";

/**
 * Project detail header (P-03): identity, editing and the archive/restore
 * switch. The task list and board views land in P-04/P-05.
 */
export function ProjectDetailView() {
  const params = useParams({ from: "/projects/$projectId" });
  const [failed, setFailed] = createSignal(false);
  const [editorOpen, setEditorOpen] = createSignal(false);

  // Deep links can land here before the shell load finished; guard it.
  onMount(() => {
    if (!projectsState.loaded) void retry();
  });

  async function retry(): Promise<void> {
    setFailed(false);
    const ok = await loadAll();
    setFailed(!ok);
  }

  const project = createMemo(() => getProject(params().projectId));

  createEffect(
    on(
      () => params().projectId,
      () => setEditorOpen(false),
    ),
  );

  return (
    <Show
      when={!failed()}
      fallback={
        <div
          role="alert"
          class="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-8 text-center"
        >
          <h2 class="text-base font-semibold text-foreground">加载失败</h2>
          <p class="text-sm text-muted-foreground">项目数据加载失败，请重试。</p>
          <Button variant="secondary" size="sm" onClick={() => void retry()}>
            重试
          </Button>
        </div>
      }
    >
      <Show
        when={project()}
        fallback={
          <Show
            when={projectsState.loaded}
            fallback={<p role="status" class="p-8 text-sm text-muted-foreground">加载中…</p>}
          >
            <PlaceholderView
              title="项目不存在"
              description="该项目不存在或已被删除。"
            />
          </Show>
        }
      >
        {(project) => (
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
                  <h2 class="truncate text-lg font-semibold text-foreground">
                    {project().name}
                  </h2>
                  <Show when={project().description}>
                    <p class="mt-0.5 whitespace-pre-wrap text-sm text-muted-foreground">
                      {project().description}
                    </p>
                  </Show>
                  <Show when={project().dueAt}>
                    <p class="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                      截止：{format(new Date(project().dueAt as string), "yyyy年M月d日", { locale: zhCN })}
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
                    <Button variant="secondary" size="sm" onClick={() => void restoreProject(project().id)}>
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
            </header>

            <div class="min-h-0 flex-1 overflow-y-auto">
              <PlaceholderView
                title="任务"
                description="项目内的任务列表与看板视图将在后续里程碑中实现。"
              />
            </div>

            <ProjectEditorDialog
              open={editorOpen()}
              onOpenChange={setEditorOpen}
              project={project()}
            />
          </div>
        )}
      </Show>
    </Show>
  );
}

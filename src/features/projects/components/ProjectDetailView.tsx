import { Show, createSignal, onMount } from "solid-js";
import { useParams } from "@tanstack/solid-router";
import { Button } from "../../../common/components";
import PlaceholderView from "../../../app/PlaceholderView";
import { loadAll } from "../hooks";
import { getProject, projectsState } from "../store";
import { ProjectListView } from "./ProjectListView";

/**
 * Route wrapper for `/projects/$projectId`: guards the one-shot initial
 * load (deep links can land here first), resolves the live project row and
 * hands off to the project work area.
 */
export function ProjectDetailView() {
  const params = useParams({ from: "/projects/$projectId" });
  const [failed, setFailed] = createSignal(false);

  onMount(() => {
    if (!projectsState.loaded) void retry();
  });

  async function retry(): Promise<void> {
    setFailed(false);
    const ok = await loadAll();
    setFailed(!ok);
  }

  const project = () => getProject(params().projectId);

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
            <PlaceholderView title="项目不存在" description="该项目不存在或已被删除。" />
          </Show>
        }
      >
        {(project) => <ProjectListView project={project()} />}
      </Show>
    </Show>
  );
}

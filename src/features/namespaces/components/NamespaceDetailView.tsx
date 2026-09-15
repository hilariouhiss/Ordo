import { Show, createSignal, onMount } from "solid-js";
import { useParams } from "@tanstack/solid-router";
import { Button } from "../../../common/components";
import PlaceholderView from "../../../app/PlaceholderView";
import { loadAll as loadProjects } from "../../projects/hooks";
import { projectsState } from "../../projects/store";
import { loadAll as loadNamespaces } from "../hooks";
import { getNamespace, namespacesState } from "../store";
import { NamespaceProjectsView } from "./NamespaceProjectsView";

/**
 * Route wrapper for `/namespaces/$namespaceId`: guards the one-shot loads
 * (a deep link can land here first), resolves the live namespace row and hands
 * off to the group work area.
 */
export function NamespaceDetailView() {
  const params = useParams({ from: "/namespaces/$namespaceId" });
  const [failed, setFailed] = createSignal(false);

  onMount(() => {
    if (!namespacesState.loaded) void retry();
  });

  async function retry(): Promise<void> {
    setFailed(false);
    // Projects carry the membership, so the group cannot render without them —
    // and a projects-only failure has to reach `failed` too, or the view shows
    // an empty group with no way to retry.
    const projects = projectsState.loaded ? Promise.resolve(true) : loadProjects();
    const [namespacesOk, projectsOk] = await Promise.all([loadNamespaces(), projects]);
    setFailed(!namespacesOk || !projectsOk);
  }

  const namespace = () => getNamespace(params().namespaceId);

  return (
    <Show
      when={!failed()}
      fallback={
        <div
          role="alert"
          class="flex h-full min-h-64 flex-col items-center justify-center gap-3 p-8 text-center"
        >
          <h2 class="text-base font-semibold text-foreground">加载失败</h2>
          <p class="text-sm text-muted-foreground">命名空间数据加载失败，请重试。</p>
          <Button variant="secondary" size="sm" onClick={() => void retry()}>
            重试
          </Button>
        </div>
      }
    >
      <Show
        when={namespace()}
        fallback={
          <Show
            when={namespacesState.loaded}
            fallback={<p role="status" class="p-8 text-sm text-muted-foreground">加载中…</p>}
          >
            <PlaceholderView title="命名空间不存在" description="该命名空间不存在或已被删除。" />
          </Show>
        }
      >
        {(namespace) => <NamespaceProjectsView namespace={namespace()} />}
      </Show>
    </Show>
  );
}

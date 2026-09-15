import { For, Show, createMemo, createSignal } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Link } from "@tanstack/solid-router";
import { Archive, FolderKanban, MoreHorizontal, Pencil, Plus, RotateCcw } from "lucide-solid";
import { Button, DropdownMenu, EmptyState, iconButtonClass } from "../../../common/components";
import { getIcon } from "../../../common/icons";
import { tasksState } from "../../tasks/store";
import { ProjectEditorDialog } from "../../projects/components/ProjectEditorDialog";
import { ProjectProgress } from "../../projects/components/ProjectProgress";
import { archiveProject, updateProject } from "../../projects/hooks";
import type { Project } from "../../projects/types";
import { archiveNamespace, restoreNamespace } from "../hooks";
import { getNamespace, projectsInNamespace } from "../store";
import type { Namespace } from "../types";
import { NamespaceEditorDialog } from "./NamespaceEditorDialog";

/**
 * Namespace work area: the group's identity header with an aggregate progress
 * summary, and the projects filed under it.
 *
 * Every number derives from the live stores (projects + tasks), so completing a
 * task moves the group's bar in the same tick — no backend aggregation command
 * and no refresh window. Archived projects are managed from the sidebar's
 * archived section, so this page lists active ones only: one place per project.
 */
export function NamespaceProjectsView(props: { namespace: Namespace }) {
  // Prefer the live store row so optimistic patches (renames, archive flips)
  // update the header immediately; fall back to the opening snapshot.
  const namespace = createMemo(() => getNamespace(props.namespace.id) ?? props.namespace);
  const projects = createMemo(() => projectsInNamespace(namespace().id));

  /** Tasks across every project in the group — the aggregate progress input. */
  const tasks = createMemo(() => {
    const ids = new Set(projects().map((project) => project.id));
    return tasksState.tasks.filter((task) => task.projectId !== null && ids.has(task.projectId));
  });

  const tasksOf = (projectId: string) =>
    tasksState.tasks.filter((task) => task.projectId === projectId);

  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingProject, setEditingProject] = createSignal<Project | null>(null);
  const [namespaceEditorOpen, setNamespaceEditorOpen] = createSignal(false);

  const openCreate = () => {
    setEditingProject(null);
    setEditorOpen(true);
  };

  const openEdit = (project: Project) => {
    setEditingProject(project);
    setEditorOpen(true);
  };

  return (
    <div class="flex h-full min-h-0 flex-col">
      <header class="shrink-0 px-5 pb-4 pt-5">
        <div class="flex items-start gap-3.5">
          <span
            class="flex size-10 shrink-0 items-center justify-center rounded-lg"
            style={{
              "background-color": namespace().color
                ? `color-mix(in srgb, ${namespace().color} 18%, transparent)`
                : "var(--surface-hover)",
              color: namespace().color ?? "var(--muted-foreground)",
            }}
          >
            <Dynamic component={getIcon(namespace().icon)} size={20} />
          </span>

          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <h2 class="truncate text-lg font-semibold tracking-tight text-foreground">
                {namespace().name}
              </h2>
              <Show when={namespace().status === "archived"}>
                <span class="shrink-0 rounded-sm bg-surface-hover px-1.5 py-0.5 text-2xs text-muted-foreground">
                  已归档
                </span>
              </Show>
            </div>
            <Show when={namespace().description}>
              {(description) => (
                <p class="mt-1 text-sm text-muted-foreground">{description()}</p>
              )}
            </Show>

            <div class="mt-3.5 flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setNamespaceEditorOpen(true)}
              >
                <Pencil size={13} aria-hidden="true" />
                编辑
              </Button>
              <Show
                when={namespace().status === "archived"}
                fallback={
                  <Button
                    variant="secondary"
                    size="sm"
                    aria-label="归档命名空间"
                    onClick={() => void archiveNamespace(namespace().id)}
                  >
                    <Archive size={13} aria-hidden="true" />
                    归档
                  </Button>
                }
              >
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label="恢复命名空间"
                  onClick={() => void restoreNamespace(namespace().id)}
                >
                  <RotateCcw size={13} aria-hidden="true" />
                  恢复
                </Button>
              </Show>
            </div>
          </div>
        </div>

        <div class="mt-4">
          <p class="pb-2 text-xs text-subtle-foreground">
            {projects().length} 个项目 · 汇总进度
          </p>
          {/* §8.5: only top-level tasks, here and on each project card below. */}
          <ProjectProgress tasks={tasks().filter((task) => task.parentTaskId === null)} />
        </div>
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <Show
          when={projects().length > 0}
          fallback={
            <EmptyState
              icon={<FolderKanban size={22} aria-hidden="true" />}
              title="这个命名空间还没有项目"
              description="把相关的项目放进来，就能在一处看到整组的进度。"
              action={
                <Button size="sm" onClick={openCreate}>
                  <Plus size={14} aria-hidden="true" />
                  新建项目
                </Button>
              }
            />
          }
        >
          <ul class="flex flex-col gap-2">
            <For each={projects()}>
              {(project) => (
                <li class="flex items-start gap-3 rounded-lg border border-border bg-surface px-3.5 py-3">
                  <span
                    class="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md"
                    style={{
                      "background-color": project.color
                        ? `color-mix(in srgb, ${project.color} 18%, transparent)`
                        : "var(--surface-hover)",
                      color: project.color ?? "var(--muted-foreground)",
                    }}
                  >
                    <Dynamic component={getIcon(project.icon)} size={16} />
                  </span>

                  <div class="min-w-0 flex-1">
                    <Link
                      to="/projects/$projectId"
                      params={{ projectId: project.id }}
                      class="rounded-sm text-sm font-medium text-foreground transition-colors hover:text-primary focus-ring"
                    >
                      {project.name}
                    </Link>
                    <div class="mt-1.5">
                      <ProjectProgress
                        tasks={tasksOf(project.id).filter(
                          (task) => task.parentTaskId === null,
                        )}
                      />
                    </div>
                  </div>

                  <DropdownMenu.Root>
                    <DropdownMenu.Trigger
                      class={iconButtonClass}
                      aria-label={`项目操作 ${project.name}`}
                    >
                      <MoreHorizontal size={15} aria-hidden="true" />
                    </DropdownMenu.Trigger>
                    <DropdownMenu.Portal>
                      <DropdownMenu.Content>
                        <DropdownMenu.Item onSelect={() => openEdit(project)}>
                          编辑项目
                        </DropdownMenu.Item>
                        <DropdownMenu.Item
                          onSelect={() => void updateProject(project.id, { namespaceId: null })}
                        >
                          移出命名空间
                        </DropdownMenu.Item>
                        <DropdownMenu.Item onSelect={() => void archiveProject(project.id)}>
                          归档项目
                        </DropdownMenu.Item>
                      </DropdownMenu.Content>
                    </DropdownMenu.Portal>
                  </DropdownMenu.Root>
                </li>
              )}
            </For>
          </ul>
        </Show>
      </div>

      <ProjectEditorDialog
        open={editorOpen()}
        onOpenChange={setEditorOpen}
        project={editingProject() ?? undefined}
        defaultNamespaceId={namespace().id}
      />

      <NamespaceEditorDialog
        open={namespaceEditorOpen()}
        onOpenChange={setNamespaceEditorOpen}
        namespace={namespace()}
      />
    </div>
  );
}

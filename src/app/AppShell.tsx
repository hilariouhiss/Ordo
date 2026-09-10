import { For, Show, createSignal, onMount, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Link, Outlet, useLocation } from "@tanstack/solid-router";
import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Inbox,
  ListTodo,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sun,
} from "lucide-solid";
import { ThemeToggle } from "../common/components/ThemeToggle";
import { sidebarCollapsed, toggleSidebar } from "../common/stores/ui";
import { ProjectEditorDialog } from "../features/projects/components/ProjectEditorDialog";
import { loadAll as loadProjects, restoreProject } from "../features/projects/hooks";
import { getProjectIcon } from "../features/projects/icons";
import {
  activeProjects,
  archivedProjects,
  projectsState,
} from "../features/projects/store";
import type { Project } from "../features/projects/types";

type NavPath =
  | "/inbox"
  | "/today"
  | "/upcoming"
  | "/completed"
  | "/stats"
  | "/search"
  | "/settings";

function titleFor(pathname: string): string {
  if (pathname.startsWith("/projects/")) return "项目";
  switch (pathname) {
    case "/inbox":
      return "收件箱";
    case "/today":
      return "今天";
    case "/upcoming":
      return "即将到来";
    case "/completed":
      return "已完成";
    case "/stats":
      return "统计";
    case "/search":
      return "搜索";
    case "/settings":
      return "设置";
    default:
      return "Ordo";
  }
}

function NavItem(props: {
  to: NavPath;
  icon: JSX.Element;
  label: string;
  collapsed: boolean;
}) {
  return (
    <Link
      to={props.to}
      class="flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors"
      activeProps={{ class: "bg-primary/10 font-medium text-primary" }}
      inactiveProps={{
        class: "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      }}
      title={props.label}
    >
      <span class="shrink-0">{props.icon}</span>
      <Show when={!props.collapsed}>{props.label}</Show>
    </Link>
  );
}

export default function AppShell() {
  const location = useLocation();
  const collapsed = () => sidebarCollapsed();
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingProject, setEditingProject] = createSignal<Project | null>(null);
  const [archivedOpen, setArchivedOpen] = createSignal(false);

  // The sidebar always shows projects, so the root shell owns the one-shot
  // initial load (retried by navigation remounts until it succeeds).
  onMount(() => {
    if (!projectsState.loaded) void loadProjects();
  });

  const openCreateProject = () => {
    setEditingProject(null);
    setEditorOpen(true);
  };

  const projectLinkClass = () =>
    "flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors";
  const projectIcon = (project: Project) => (
    <span
      class="shrink-0"
      style={project.color ? { color: project.color } : undefined}
    >
      <Dynamic component={getProjectIcon(project.icon)} size={16} />
    </span>
  );

  return (
    <div class="flex h-screen overflow-hidden bg-background text-foreground">
      <aside
        aria-label="侧边栏导航"
        class={`flex shrink-0 flex-col border-r border-border bg-surface ${
          collapsed() ? "w-14" : "w-60"
        }`}
      >
        <div class="flex h-14 shrink-0 items-center gap-2.5 px-3.5">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <ListTodo size={18} aria-hidden="true" />
          </span>
          <Show when={!collapsed()}>
            <span class="text-base font-semibold tracking-tight">Ordo</span>
          </Show>
        </div>

        <nav aria-label="搜索" class="flex flex-col gap-1 px-2 pt-3">
          <NavItem to="/search" icon={<Search size={18} />} label="搜索" collapsed={collapsed()} />
        </nav>

        <nav aria-label="任务视图" class="flex flex-col gap-1 px-2 pb-3 pt-2">
          <Show when={!collapsed()}>
            <p class="px-3 pb-1.5 text-xs font-medium text-subtle-foreground">任务</p>
          </Show>
          <NavItem to="/inbox" icon={<Inbox size={18} />} label="收件箱" collapsed={collapsed()} />
          <NavItem to="/today" icon={<Sun size={18} />} label="今天" collapsed={collapsed()} />
          <NavItem
            to="/upcoming"
            icon={<CalendarClock size={18} />}
            label="即将到来"
            collapsed={collapsed()}
          />
          <NavItem
            to="/completed"
            icon={<CheckCircle2 size={18} />}
            label="已完成"
            collapsed={collapsed()}
          />
        </nav>

        <div class="min-h-0 flex-1 overflow-y-auto px-2 py-3">
          <Show
            when={!collapsed()}
            fallback={<div class="mx-auto mb-2 w-8 border-t border-border" aria-hidden="true" />}
          >
            <div class="mb-1.5 flex items-center justify-between px-3">
              <p class="text-xs font-medium text-subtle-foreground">项目</p>
              <button
                type="button"
                aria-label="新建项目"
                class="flex size-5 items-center justify-center rounded text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                onClick={openCreateProject}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
          </Show>

          <nav aria-label="项目列表" class="flex flex-col gap-1">
            <For each={activeProjects()}>
              {(project) => (
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  class={projectLinkClass()}
                  activeProps={{ class: `${projectLinkClass()} bg-primary/10 font-medium text-primary` }}
                  inactiveProps={{
                    class: `${projectLinkClass()} text-muted-foreground hover:bg-surface-hover hover:text-foreground`,
                  }}
                  title={project.name}
                >
                  {projectIcon(project)}
                  <Show when={!collapsed()}>
                    <span class="min-w-0 truncate">{project.name}</span>
                  </Show>
                </Link>
              )}
            </For>
          </nav>

          <Show
            when={!collapsed() && archivedProjects().length > 0}
            fallback={
              <Show when={!collapsed() && activeProjects().length === 0}>
                <p class="px-3 py-1 text-sm text-subtle-foreground">暂无项目</p>
              </Show>
            }
          >
            <button
              type="button"
              class="mt-2 flex w-full items-center gap-1.5 rounded px-3 py-1 text-xs text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              aria-expanded={archivedOpen()}
              onClick={() => setArchivedOpen(!archivedOpen())}
            >
              <ChevronDown
                size={12}
                aria-hidden="true"
                class="transition-transform motion-reduce:transition-none"
                classList={{ "-rotate-90": !archivedOpen() }}
              />
              已归档 ({archivedProjects().length})
            </button>
            <Show when={archivedOpen()}>
              <nav aria-label="已归档项目" class="mt-1 flex flex-col gap-1">
                <For each={archivedProjects()}>
                  {(project) => (
                    <div class="group flex items-center gap-1 pr-1.5">
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: project.id }}
                        class="flex min-w-0 flex-1 items-center gap-3 rounded-md px-3 py-2 text-sm text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-muted-foreground"
                        title={project.name}
                      >
                        {projectIcon(project)}
                        <span class="min-w-0 truncate">{project.name}</span>
                      </Link>
                      <button
                        type="button"
                        aria-label={`恢复项目 ${project.name}`}
                        title="恢复项目"
                        class="flex size-6 shrink-0 items-center justify-center rounded text-subtle-foreground transition-colors hover:bg-surface-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
                        onClick={() => void restoreProject(project.id)}
                      >
                        <RotateCcw size={13} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </For>
              </nav>
            </Show>
          </Show>
        </div>

        <nav aria-label="其他" class="flex flex-col gap-1 border-t border-border px-2 py-3">
          <NavItem to="/stats" icon={<BarChart3 size={18} />} label="统计" collapsed={collapsed()} />
          <ThemeToggle
            class="w-full gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
            showLabel={!collapsed()}
          />
          <NavItem
            to="/settings"
            icon={<Settings size={18} />}
            label="设置"
            collapsed={collapsed()}
          />
        </nav>

        <div class="border-t border-border p-2">
          <button
            type="button"
            class="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
            aria-label={collapsed() ? "展开侧边栏" : "收起侧边栏"}
            onClick={toggleSidebar}
          >
            <span class="shrink-0">
              {collapsed() ? (
                <PanelLeftOpen size={18} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={18} aria-hidden="true" />
              )}
            </span>
            <Show when={!collapsed()}>收起侧边栏</Show>
          </button>
        </div>
      </aside>

      <div class="flex min-w-0 flex-1 flex-col">
        <header class="flex h-14 shrink-0 items-center border-b border-border px-6">
          <h1 class="text-lg font-semibold">{titleFor(location().pathname)}</h1>
        </header>
        <main class="min-h-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>

      <ProjectEditorDialog
        open={editorOpen()}
        onOpenChange={setEditorOpen}
        project={editingProject() ?? undefined}
      />
    </div>
  );
}

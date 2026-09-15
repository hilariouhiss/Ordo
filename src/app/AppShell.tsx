import { For, Show, createSignal, onMount, type JSX } from "solid-js";
import { Dynamic } from "solid-js/web";
import { Link, Outlet } from "@tanstack/solid-router";
import {
  BarChart3,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  Inbox,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Sun,
} from "lucide-solid";
import { listen } from "@tauri-apps/api/event";
import { ThemeToggle } from "../common/components/ThemeToggle";
import { Toaster, iconButtonClass } from "../common/components";
import { EVENTS } from "../common/ipc/events";
import { sidebarCollapsed, toggleSidebar } from "../common/stores/ui";
import { getIcon } from "../common/icons";
import TaskViewer from "./TaskViewer";
import { ProjectEditorDialog } from "../features/projects/components/ProjectEditorDialog";
import { loadAll as loadProjects, restoreProject } from "../features/projects/hooks";
import {
  activeProjects,
  archivedProjects,
  projectsState,
} from "../features/projects/store";
import type { Project } from "../features/projects/types";
import { subscribeToReminders } from "../features/tasks/reminders";
import { BlockedConfirmHost } from "../features/tasks/components/BlockedConfirmHost";
import { reloadTasks } from "../features/tasks/hooks";

type NavPath =
  | "/inbox"
  | "/today"
  | "/upcoming"
  | "/completed"
  | "/stats"
  | "/search"
  | "/settings";

/**
 * The Ordo mark: three rows shortening left to right, the same shape as the
 * favicon and as every progress bar in the app.
 */
function BrandMark() {
  return (
    <span class="flex size-7 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
      <svg viewBox="0 0 16 16" class="size-3.5" fill="currentColor" aria-hidden="true">
        <rect x="1" y="2.2" width="14" height="2.6" rx="1.3" />
        <rect x="1" y="6.7" width="9.5" height="2.6" rx="1.3" opacity="0.68" />
        <rect x="1" y="11.2" width="5" height="2.6" rx="1.3" opacity="0.38" />
      </svg>
    </span>
  );
}

/**
 * One sidebar row. `Link` and the plain buttons below share this class so the
 * footer cluster and the nav cannot drift apart.
 */
function navRowClass(collapsed: boolean): string {
  return `flex items-center gap-2.5 rounded-md text-sm transition duration-150 ease-out focus-ring ${
    collapsed ? "size-8 justify-center" : "px-2.5 py-1.5"
  }`;
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
      class={`${navRowClass(props.collapsed)} text-muted-foreground hover:bg-surface-hover hover:text-foreground`}
      activeProps={{
        class: `${navRowClass(props.collapsed)} bg-primary/10 font-medium text-primary`,
        "aria-current": "page",
      }}
      title={props.label}
    >
      <span class="shrink-0">{props.icon}</span>
      <Show when={!props.collapsed}>{props.label}</Show>
    </Link>
  );
}

/** Section caption. No `uppercase`/`tracking`: this UI is Chinese, where both
 * are no-ops on the glyphs and only misalign the Latin it does contain. */
function SectionLabel(props: { children: JSX.Element }) {
  return <p class="px-2.5 pb-1 text-xs text-subtle-foreground">{props.children}</p>;
}

export default function AppShell() {
  const collapsed = () => sidebarCollapsed();
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingProject, setEditingProject] = createSignal<Project | null>(null);
  const [archivedOpen, setArchivedOpen] = createSignal(false);

  // The sidebar always shows projects, so the root shell owns the one-shot
  // initial load (retried by navigation remounts until it succeeds) and the
  // app-lifetime reminder event subscription.
  onMount(() => {
    if (!projectsState.loaded) void loadProjects();
    void subscribeToReminders();
    // The quick-add window (D-02) is a separate webview with its own store, so
    // a task filed there stays invisible here until the list is pulled again.
    // Tasks + tags only: that window creates nothing but bare tasks, and the
    // bulk subtask rebuild would clobber a cache the user is writing to.
    listen(EVENTS.taskCreated, () => void reloadTasks()).catch(() => {});
  });

  const openCreateProject = () => {
    setEditingProject(null);
    setEditorOpen(true);
  };

  const projectIcon = (project: Project) => (
    <span class="shrink-0" style={project.color ? { color: project.color } : undefined}>
      <Dynamic component={getIcon(project.icon)} size={16} />
    </span>
  );

  return (
    <div class="flex h-dvh overflow-hidden bg-background text-foreground">
      {/* Keyboard users otherwise tab through every nav row and every project
          before reaching the view. */}
      <a
        href="#ordo-main"
        class="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50 focus:rounded-md focus:bg-elevated focus:px-3 focus:py-2 focus:text-sm focus:shadow-lg focus-ring"
      >
        跳到主内容
      </a>

      <aside
        aria-label="侧边栏导航"
        class={`flex shrink-0 flex-col border-r border-border bg-surface ${
          collapsed() ? "w-13" : "w-56"
        }`}
      >
        <div
          class={`flex h-12 shrink-0 items-center gap-2.5 ${collapsed() ? "justify-center px-2" : "px-3"}`}
        >
          <BrandMark />
          <Show when={!collapsed()}>
            <span class="text-sm font-semibold tracking-tight">Ordo</span>
          </Show>
        </div>

        {/* Search sits above the views rather than inside "任务": it is a
            different kind of action, not a fifth list. */}
        <nav aria-label="搜索" class="flex flex-col gap-0.5 px-2">
          <NavItem to="/search" icon={<Search size={17} />} label="搜索" collapsed={collapsed()} />
        </nav>

        <nav aria-label="任务视图" class="mt-4 flex flex-col gap-0.5 px-2">
          <Show when={!collapsed()}>
            <SectionLabel>任务</SectionLabel>
          </Show>
          <NavItem to="/inbox" icon={<Inbox size={17} />} label="收件箱" collapsed={collapsed()} />
          <NavItem to="/today" icon={<Sun size={17} />} label="今天" collapsed={collapsed()} />
          <NavItem
            to="/upcoming"
            icon={<CalendarClock size={17} />}
            label="即将到来"
            collapsed={collapsed()}
          />
          <NavItem
            to="/completed"
            icon={<CheckCircle2 size={17} />}
            label="已完成"
            collapsed={collapsed()}
          />
        </nav>

        <div class="mt-4 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <Show
            when={!collapsed()}
            fallback={<div class="mx-auto mt-2 w-6 border-t border-border" aria-hidden="true" />}
          >
            <div class="flex items-center justify-between pb-1 pl-2.5 pr-0.5">
              <p class="text-xs text-subtle-foreground">项目</p>
              <button
                type="button"
                aria-label="新建项目"
                title="新建项目"
                class={iconButtonClass}
                onClick={openCreateProject}
              >
                <Plus size={14} aria-hidden="true" />
              </button>
            </div>
          </Show>

          <nav aria-label="项目列表" class="flex flex-col gap-0.5">
            <For each={activeProjects()}>
              {(project) => (
                <Link
                  to="/projects/$projectId"
                  params={{ projectId: project.id }}
                  class={`${navRowClass(collapsed())} text-muted-foreground hover:bg-surface-hover hover:text-foreground`}
                  activeProps={{
                    class: `${navRowClass(collapsed())} bg-primary/10 font-medium text-primary`,
                    "aria-current": "page",
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

          <Show when={!collapsed() && activeProjects().length === 0}>
            <p class="px-2.5 py-1 text-xs text-subtle-foreground">暂无项目</p>
          </Show>

          <Show when={!collapsed() && archivedProjects().length > 0}>
            <button
              type="button"
              class="mt-1.5 flex w-full items-center gap-1.5 rounded-md px-2.5 py-1 text-xs text-subtle-foreground transition duration-150 ease-out hover:bg-surface-hover hover:text-muted-foreground focus-ring"
              aria-expanded={archivedOpen()}
              onClick={() => setArchivedOpen(!archivedOpen())}
            >
              <ChevronDown
                size={12}
                aria-hidden="true"
                class="transition-transform duration-200 ease-out"
                classList={{ "-rotate-90": !archivedOpen() }}
              />
              已归档 ({archivedProjects().length})
            </button>
            <Show when={archivedOpen()}>
              <nav aria-label="已归档项目" class="mt-0.5 flex flex-col gap-0.5">
                <For each={archivedProjects()}>
                  {(project) => (
                    <div class="group flex items-center gap-0.5">
                      <Link
                        to="/projects/$projectId"
                        params={{ projectId: project.id }}
                        class="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm text-subtle-foreground transition duration-150 ease-out hover:bg-surface-hover hover:text-muted-foreground focus-ring"
                        title={project.name}
                      >
                        {projectIcon(project)}
                        <span class="min-w-0 truncate">{project.name}</span>
                      </Link>
                      <button
                        type="button"
                        aria-label={`恢复项目 ${project.name}`}
                        title="恢复项目"
                        class={`${iconButtonClass} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
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

        {/* One cluster, one divider. The collapse control lives here rather
            than in its own bordered block: same position in both states, and
            one less horizontal rule cutting the sidebar in half. */}
        <nav aria-label="其他" class="flex flex-col gap-0.5 border-t border-border p-2">
          <NavItem to="/stats" icon={<BarChart3 size={17} />} label="统计" collapsed={collapsed()} />
          <ThemeToggle class={navRowClass(collapsed())} showLabel={!collapsed()} />
          <NavItem
            to="/settings"
            icon={<Settings size={17} />}
            label="设置"
            collapsed={collapsed()}
          />
          <button
            type="button"
            class={`${navRowClass(collapsed())} text-subtle-foreground hover:bg-surface-hover hover:text-foreground`}
            aria-label={collapsed() ? "展开侧边栏" : "收起侧边栏"}
            title={collapsed() ? "展开侧边栏" : "收起侧边栏"}
            onClick={toggleSidebar}
          >
            <span class="shrink-0">
              {collapsed() ? (
                <PanelLeftOpen size={17} aria-hidden="true" />
              ) : (
                <PanelLeftClose size={17} aria-hidden="true" />
              )}
            </span>
            <Show when={!collapsed()}>收起侧边栏</Show>
          </button>
        </nav>
      </aside>

      {/* No shell-level header: each view renders its own, inline with its
          toolbar. A 56px bar holding nothing but the page title, above a view
          that already rendered the same word, cost a strip of chrome and a
          duplicate heading on every route. */}
      <main id="ordo-main" class="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>

      <ProjectEditorDialog
        open={editorOpen()}
        onOpenChange={setEditorOpen}
        project={editingProject() ?? undefined}
      />

      <TaskViewer />

      <BlockedConfirmHost />

      <Toaster />
    </div>
  );
}

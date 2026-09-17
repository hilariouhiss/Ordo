import { For, Show, createMemo, createSignal, onMount, type JSX } from "solid-js";
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
import { mark, markInteractive } from "../common/perf";
import { ThemeToggle } from "../common/components/ThemeToggle";
import { Toaster, iconButtonClass } from "../common/components";
import { EVENTS } from "../common/ipc/events";
import { beginDrag, draggedId, endDrag } from "../common/stores/drag";
import { pushInfo } from "../common/stores/notifications";
import { openTaskViewer } from "../common/stores/taskViewer";
import { sidebarCollapsed, toggleSidebar } from "../common/stores/ui";
import { getIcon } from "../common/icons";
import TaskViewer from "./TaskViewer";
import { NamespaceEditorDialog } from "../features/namespaces/components/NamespaceEditorDialog";
import { loadAll as loadNamespaces, restoreNamespace } from "../features/namespaces/hooks";
import {
  activeNamespaces,
  archivedLooseProjects,
  archivedNamespaces,
  archivedProjectsOf,
  namespacesState,
  projectsInNamespace,
  ungroupedProjects,
} from "../features/namespaces/store";
import type { Namespace } from "../features/namespaces/types";
import { ProjectEditorDialog } from "../features/projects/components/ProjectEditorDialog";
import {
  loadAll as loadProjects,
  restoreProject,
  updateProject,
} from "../features/projects/hooks";
import { archivedProjects, getProject, projectsState } from "../features/projects/store";
import type { Project } from "../features/projects/types";
import { subscribeToReminders } from "../features/tasks/reminders";
import { BlockedConfirmHost } from "../features/tasks/components/BlockedConfirmHost";
import * as tasksApi from "../features/tasks/api";
import {
  ensureScope,
  loadAll as loadTasks,
  loadUnfinishedCounts,
  reloadTasks,
  updateTask,
} from "../features/tasks/hooks";
import {
  getTask,
  scopeMetaOf,
  scopeRows,
  tasksState,
  unfinishedCountOf,
} from "../features/tasks/store";

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

/**
 * Row geometry for the project tree. A row's content column must not depend on
 * whether the row can expand, so the chevron gets its own 20px slot *left* of
 * the content and the row pulls itself left by that slot instead of pushing its
 * content right. The shared 28px `iconButtonClass` chevron plus its 2px gap came
 * to 30px — exactly the `child-indent` step — which is why a group's own line
 * used to land on its children's column.
 *
 * Level 0 (`-ml-2`) puts the slot in the sidebar's own 8px gutter, a hair right
 * of the nav icons above it; level 1 (`-ml-2.5`) puts it on the child list's
 * guide line, which leaves those rows exactly where they already were.
 */
function treeRowClass(level: 0 | 1): string {
  return `flex items-center rounded-md ${level === 0 ? "-ml-2" : "-ml-2.5"}`;
}

/** The `Link` half of such a row: the slot already spent the leading padding. */
const TREE_CONTENT_CLASS =
  "flex items-center gap-2.5 rounded-md text-sm transition duration-150 ease-out focus-ring ml-0.5 py-1.5 pr-2.5";

/** A row's unfinished-task list: the shared indent step, with the title landing
 * under the project's name rather than under its icon. */
const TREE_LEAF_CLASS =
  "flex w-full items-center rounded-md py-1 pl-1.5 pr-2 text-sm text-muted-foreground transition duration-150 ease-out hover:bg-surface-hover hover:text-foreground focus-ring";

/**
 * The disclosure chevron that opens a group: 20px wide, not the shared 28px
 * `iconButtonClass`, because the slot has to fit inside one indent step while the
 * row it belongs to stays on its own column.
 */
function Disclosure(props: { open: boolean; label: string; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={props.open}
      aria-label={props.label}
      class="flex h-7 w-5 shrink-0 items-center justify-center rounded-md text-subtle-foreground transition duration-150 ease-out hover:bg-surface-hover hover:text-foreground focus-ring"
      onClick={props.onToggle}
    >
      <ChevronDown
        size={12}
        aria-hidden="true"
        class="transition-transform duration-200 ease-out"
        classList={{ "-rotate-90": !props.open }}
      />
    </button>
  );
}

/** A row with nothing to disclose keeps the slot, or its content would sit a
 * column left of its siblings'. */
function DisclosureSpacer() {
  return <span aria-hidden="true" class="h-7 w-5 shrink-0" />;
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

/**
 * A section caption with the trailing ＋ that creates one more of it (R4).
 *
 * Both creation entries in the sidebar wear this row — 项目 and 命名空间 — so
 * the two sections read as siblings instead of one having a labelled header
 * and the other a full-width button under its own list.
 */
function CreateHeader(props: { label: string; onCreate: () => void; class?: string }) {
  return (
    <div class={`flex items-center justify-between pb-1 pl-2.5 pr-0.5 ${props.class ?? ""}`}>
      <p class="text-xs text-subtle-foreground">{props.label}</p>
      <button
        type="button"
        aria-label={`新建${props.label}`}
        title={`新建${props.label}`}
        class={iconButtonClass}
        onClick={props.onCreate}
      >
        <Plus size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

/** One project row. `muted` is the archived variant: dimmer text, same layout.
 *
 * It is both a drag source (R7a: file it under another namespace) and a drop
 * target (R7b/§9.4: drop a task here to move it into this project *and* out of
 * whatever parent it had — the user only asked for the project, so the broken
 * parent link gets announced). */
function ProjectLink(props: { project: Project; collapsed: boolean; muted?: boolean }) {
  const [taskOver, setTaskOver] = createSignal(false);

  const taskId = (event: DragEvent) => draggedId(event, "task");

  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: props.project.id }}
      draggable={true}
      onDragStart={(event) =>
        beginDrag(event, { kind: "project", id: props.project.id })
      }
      onDragEnd={endDrag}
      onDragOver={(event) => {
        const id = taskId(event);
        const current = id ? getTask(id) : undefined;
        // Already here *and* already top-level: the drop would write nothing.
        if (!current || (current.projectId === props.project.id && current.parentTaskId === null))
          return;
        // preventDefault is what makes this element a drop target at all.
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        setTaskOver(true);
      }}
      onDragLeave={() => setTaskOver(false)}
      onDrop={(event) => {
        const id = taskId(event);
        setTaskOver(false);
        if (!id) return;
        event.preventDefault();
        endDrag();
        const dragged = getTask(id);
        if (!dragged || (dragged.projectId === props.project.id && dragged.parentTaskId === null))
          return;
        const wasChild = dragged.parentTaskId !== null;
        // §9.4: a project row means "this project, top level" — landing a child
        // here breaks its parent link too, so say so.
        void updateTask(id, { projectId: props.project.id, parentTaskId: null }).then(
          (saved) => {
            if (saved && wasChild)
              pushInfo(`「${saved.title}」已移出父任务并归入「${props.project.name}」`);
          },
        );
      }}
      class={`${props.collapsed ? navRowClass(true) : TREE_CONTENT_CLASS} min-w-0 flex-1 ${
        props.muted
          ? "text-subtle-foreground hover:text-muted-foreground"
          : "text-muted-foreground hover:text-foreground"
      } hover:bg-surface-hover`}
      classList={{ "bg-primary/10 ring-1 ring-inset ring-primary/40": taskOver() }}
      activeProps={{
        class: `${props.collapsed ? navRowClass(true) : TREE_CONTENT_CLASS} min-w-0 flex-1 bg-primary/10 font-medium text-primary`,
        "aria-current": "page",
      }}
      title={props.project.name}
    >
      <span
        class="shrink-0"
        style={props.project.color ? { color: props.project.color } : undefined}
      >
        <Dynamic component={getIcon(props.project.icon)} size={16} />
      </span>
      <Show when={!props.collapsed}>
        <span class="min-w-0 truncate">{props.project.name}</span>
      </Show>
    </Link>
  );
}

/**
 * One project row plus the disclosure that lists the project's unfinished tasks.
 *
 * `nested` = the project belongs to a namespace, so it takes the level-1 row
 * geometry (chevron on the guide line) instead of the level-0 one. `trailing`
 * carries the archived rows' 恢复 button.
 *
 * Open/closed is local, like `collapsedGroups`: view state, not data. Only
 * *top-level* unfinished tasks are listed — a child already reads as part of its
 * parent everywhere else, and the sidebar has no room for the whole tree.
 */
function ProjectItem(props: {
  project: Project;
  collapsed: boolean;
  nested?: boolean;
  muted?: boolean;
  trailing?: JSX.Element;
}) {
  const [open, setOpen] = createSignal(false);
  /** 这个项目的范围：展开时才装载（箭头来自计数聚合，不需要行）。 */
  const scope = () => `project:${props.project.id}`;
  /** 箭头问的就是这一个数：服务端聚合说还有未完成顶层行才画。 */
  const hasUnfinished = () => unfinishedCountOf(props.project.id) > 0;
  /** 范围落地了吗（成功或失败都算）：没落地就先别画这个带名字的 landmark。 */
  const scopeSettled = () => {
    const meta = scopeMetaOf(scope());
    return meta.loaded || meta.error !== null;
  };
  const unfinished = createMemo(() =>
    scopeRows(scope()).filter(
      (task) => task.parentTaskId === null && task.completedAt === null,
    ),
  );

  const toggle = () => {
    const next = !open();
    setOpen(next);
    if (next) {
      void ensureScope(scope(), () => tasksApi.listTasksByProject(props.project.id));
    }
  };

  return (
    <Show
      when={!props.collapsed}
      fallback={<ProjectLink project={props.project} collapsed={true} muted={props.muted} />}
    >
      <div>
        <div class={treeRowClass(props.nested ? 1 : 0)}>
          <Show when={hasUnfinished()} fallback={<DisclosureSpacer />}>
            <Disclosure
              open={open()}
              label={`${open() ? "收起" : "展开"}项目 ${props.project.name}`}
              onToggle={toggle}
            />
          </Show>
          <ProjectLink project={props.project} collapsed={false} muted={props.muted} />
          {props.trailing}
        </div>
        {/* 装载中不画：一个只有名字、既没内容也没加载提示的 landmark 比晚一帧出现更糟。 */}
        <Show when={open() && hasUnfinished() && scopeSettled()}>
          <nav
            aria-label={`${props.project.name} 的未完成任务`}
            class="child-indent flex flex-col gap-0.5"
          >
            <For each={unfinished()}>
              {(task) => (
                <button
                  type="button"
                  class={TREE_LEAF_CLASS}
                  title={task.title}
                  onClick={() => openTaskViewer(task.id)}
                >
                  <span class="min-w-0 truncate">{task.title}</span>
                </button>
              )}
            </For>
            {/* 范围装载失败时不留一个空壳：说一句，重新展开会自己再试。 */}
            <Show when={scopeMetaOf(scope()).error !== null && unfinished().length === 0}>
              <p class="px-1.5 py-1 text-xs text-muted-foreground">任务读不出来</p>
            </Show>
          </nav>
        </Show>
      </div>
    </Show>
  );
}

/** Namespace group header: chevron toggles the group, the name navigates.
 *
 * It is also the drop target for R7a: dragging a project row onto it files the
 * project into that namespace. */
function NamespaceRow(props: {
  namespace: Namespace;
  collapsed: boolean;
  open: boolean;
  count: number;
  onToggle: () => void;
}) {
  // Collapsed, the nested nav never renders, so the chevron would toggle
  // nothing — and `flex-1 min-w-0` inside the 36px rail leaves the `Link` a
  // ~6px basis that squeezes the icon. The row then keeps the project rows'
  // plain `size-8 justify-center` geometry.
  const linkClass = () =>
    props.collapsed ? navRowClass(true) : `${TREE_CONTENT_CLASS} min-w-0 flex-1`;
  // The chevron's slot hangs in the sidebar's own gutter, so the row's name and
  // icon stay on the level-0 column however wide the arrow is (R8).
  const rowClass = () => (props.collapsed ? "flex items-center rounded-md" : treeRowClass(0));

  const [projectOver, setProjectOver] = createSignal(false);
  const draggedProject = (event: DragEvent) => draggedId(event, "project");

  return (
    <div
      class={rowClass()}
      classList={{ "bg-primary/10 ring-1 ring-inset ring-primary/40": projectOver() }}
      onDragOver={(event) => {
        const id = draggedProject(event);
        if (!id || getProject(id)?.namespaceId === props.namespace.id) return;
        event.preventDefault();
        if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
        setProjectOver(true);
      }}
      onDragLeave={() => setProjectOver(false)}
      onDrop={(event) => {
        const id = draggedProject(event);
        setProjectOver(false);
        if (!id) return;
        event.preventDefault();
        endDrag();
        if (getProject(id)?.namespaceId === props.namespace.id) return;
        void updateProject(id, { namespaceId: props.namespace.id });
      }}
    >
      <Show when={!props.collapsed}>
        <Disclosure
          open={props.open}
          label={`${props.open ? "收起" : "展开"}命名空间 ${props.namespace.name}`}
          onToggle={props.onToggle}
        />
      </Show>
      <Link
        to="/namespaces/$namespaceId"
        params={{ namespaceId: props.namespace.id }}
        class={`${linkClass()} text-muted-foreground hover:bg-surface-hover hover:text-foreground`}
        activeProps={{
          class: `${linkClass()} bg-primary/10 font-medium text-primary`,
          "aria-current": "page",
        }}
        title={props.namespace.name}
      >
        <span
          class="shrink-0"
          style={props.namespace.color ? { color: props.namespace.color } : undefined}
        >
          <Dynamic component={getIcon(props.namespace.icon)} size={16} />
        </span>
        <Show when={!props.collapsed}>
          <span class="min-w-0 flex-1 truncate">{props.namespace.name}</span>
          <span class="shrink-0 text-xs tabular-nums text-subtle-foreground">{props.count}</span>
        </Show>
      </Link>
    </div>
  );
}

export default function AppShell() {
  const collapsed = () => sidebarCollapsed();
  const [editorOpen, setEditorOpen] = createSignal(false);
  const [editingProject, setEditingProject] = createSignal<Project | null>(null);
  const [archivedOpen, setArchivedOpen] = createSignal(false);
  /** The unfiled drop zone is hot (R7a). */
  const [rootOver, setRootOver] = createSignal(false);
  const [namespaceEditorOpen, setNamespaceEditorOpen] = createSignal(false);
  // Collapsed namespaces, by id. Local on purpose: like `archivedOpen`, this is
  // view state, not data — nothing else needs it and it must not survive a
  // restart as a surprise.
  const [collapsedGroups, setCollapsedGroups] = createSignal<ReadonlySet<string>>(new Set());

  const groupOpen = (namespaceId: string) => !collapsedGroups().has(namespaceId);
  const toggleGroup = (namespaceId: string) =>
    setCollapsedGroups((current) => {
      const next = new Set(current);
      if (next.has(namespaceId)) next.delete(namespaceId);
      else next.add(namespaceId);
      return next;
    });

  // The sidebar always shows namespaces and projects, so the root shell owns
  // the one-shot initial loads (retried by navigation remounts until they
  // succeed) and the app-lifetime reminder event subscription.
  onMount(() => {
    // Q-01 性能验收的分界点：外壳挂载（路由与懒加载的视图 chunk 都已就位）。
    mark("shell-mounted");
    const initialLoads = [
      namespacesState.loaded ? undefined : loadNamespaces(),
      projectsState.loaded ? undefined : loadProjects(),
      // 侧边栏的项目箭头问的是这一条聚合，不是任务快照。
      loadUnfinishedCounts(),
      // The views still read the `all` snapshot, and `getTask` answers the
      // project rows' drag/drop — only the arrows moved off it.
      tasksState.loaded ? undefined : loadTasks(),
    ];
    // Q-01 性能验收：「首屏可交互」= 外壳的这几笔一次性加载都落地了（失败的也算
    // 落地，否则一次断网就让验收拿不到数字）。
    void Promise.allSettled(initialLoads).then(markInteractive);
    void subscribeToReminders();
    // The quick-add window (D-02) is a separate webview with its own store, so
    // a task filed there stays invisible here until the list is pulled again.
    // Tasks + tags is the whole tree — children are rows in `tasks` (R7c) — so
    // this one pull refreshes parents and children alike.
    listen(EVENTS.taskCreated, () => {
      void reloadTasks();
      void loadUnfinishedCounts();
    }).catch(() => {});
  });

  const openCreateProject = () => {
    setEditingProject(null);
    setEditorOpen(true);
  };

  // Create only: renaming and archiving a namespace live on its own page, so
  // the sidebar stays a navigation surface.
  const openCreateNamespace = () => setNamespaceEditorOpen(true);

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
            <CreateHeader label="项目" onCreate={openCreateProject} />

            {/* Sits under 项目 ＋: everything in this scroll area is the project
                tree, and namespaces are the groups inside it. */}
            <CreateHeader label="命名空间" onCreate={openCreateNamespace} class="mt-2" />
          </Show>

          <Show when={activeNamespaces().length > 0}>
            <nav aria-label="命名空间列表" class="flex flex-col gap-0.5">
              <For each={activeNamespaces()}>
                {(namespace) => (
                  <div class="flex flex-col gap-0.5">
                    <NamespaceRow
                      namespace={namespace}
                      collapsed={collapsed()}
                      open={groupOpen(namespace.id)}
                      count={projectsInNamespace(namespace.id).length}
                      onToggle={() => toggleGroup(namespace.id)}
                    />
                    <Show when={!collapsed() && groupOpen(namespace.id)}>
                      <nav
                        aria-label={`${namespace.name} 的项目`}
                        class="child-indent flex flex-col gap-0.5"
                      >
                        <For each={projectsInNamespace(namespace.id)}>
                          {(project) => (
                            <ProjectItem project={project} collapsed={collapsed()} nested />
                          )}
                        </For>
                      </nav>
                    </Show>
                  </div>
                )}
              </For>
            </nav>
          </Show>

          {/* Doubles as the "unfile it" drop zone: dropping a project here
              clears its `namespaceId` (R7a). `min-h-6` keeps that target
              reachable while the root list is empty. */}
          <nav
            aria-label="项目列表"
            class="mt-0.5 flex min-h-6 flex-col gap-0.5 rounded-md"
            classList={{ "bg-primary/10 ring-1 ring-inset ring-primary/40": rootOver() }}
            onDragOver={(event) => {
              const id = draggedId(event, "project");
              if (!id || getProject(id)?.namespaceId === null) return;
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
              setRootOver(true);
            }}
            onDragLeave={() => setRootOver(false)}
            onDrop={(event) => {
              const id = draggedId(event, "project");
              setRootOver(false);
              if (!id) return;
              event.preventDefault();
              endDrag();
              if (getProject(id)?.namespaceId === null) return;
              void updateProject(id, { namespaceId: null });
            }}
          >
            <For each={ungroupedProjects()}>
              {(project) => <ProjectItem project={project} collapsed={collapsed()} />}
            </For>
          </nav>

          <Show when={!collapsed() && ungroupedProjects().length === 0 && activeNamespaces().length === 0}>
            <p class="px-2.5 py-1 text-xs text-subtle-foreground">暂无项目</p>
          </Show>

          <Show when={!collapsed() && (archivedProjects().length > 0 || archivedNamespaces().length > 0)}>
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
              已归档 ({archivedProjects().length + archivedNamespaces().length})
            </button>
            <Show when={archivedOpen()}>
              <nav aria-label="已归档命名空间" class="mt-0.5 flex flex-col gap-0.5">
                <For each={archivedNamespaces()}>
                  {(namespace) => (
                    <div class="flex flex-col gap-0.5">
                      <div class="flex items-center gap-0.5">
                        <NamespaceRow
                          namespace={namespace}
                          collapsed={collapsed()}
                          open={groupOpen(namespace.id)}
                          count={archivedProjectsOf(namespace.id).length}
                          onToggle={() => toggleGroup(namespace.id)}
                        />
                        <button
                          type="button"
                          aria-label={`恢复命名空间 ${namespace.name}`}
                          title="恢复命名空间"
                          class={iconButtonClass}
                          onClick={() => void restoreNamespace(namespace.id)}
                        >
                          <RotateCcw size={13} aria-hidden="true" />
                        </button>
                      </div>
                      <Show when={groupOpen(namespace.id)}>
                        <nav
                          aria-label={`${namespace.name} 的项目`}
                          class="child-indent flex flex-col gap-0.5"
                        >
                          <For each={archivedProjectsOf(namespace.id)}>
                            {(project) => (
                              <ProjectItem
                                project={project}
                                collapsed={collapsed()}
                                nested
                                muted
                              />
                            )}
                          </For>
                        </nav>
                      </Show>
                    </div>
                  )}
                </For>
              </nav>

              <nav aria-label="已归档项目" class="mt-0.5 flex flex-col gap-0.5">
                <For each={archivedLooseProjects()}>
                  {(project) => (
                    <div class="group">
                      <ProjectItem
                        project={project}
                        collapsed={collapsed()}
                        muted
                        trailing={
                          <button
                            type="button"
                            aria-label={`恢复项目 ${project.name}`}
                            title="恢复项目"
                            class={`${iconButtonClass} opacity-0 group-hover:opacity-100 focus-visible:opacity-100`}
                            onClick={() => void restoreProject(project.id)}
                          >
                            <RotateCcw size={13} aria-hidden="true" />
                          </button>
                        }
                      />
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

      <NamespaceEditorDialog
        open={namespaceEditorOpen()}
        onOpenChange={setNamespaceEditorOpen}
      />

      <TaskViewer />

      <BlockedConfirmHost />

      <Toaster />
    </div>
  );
}

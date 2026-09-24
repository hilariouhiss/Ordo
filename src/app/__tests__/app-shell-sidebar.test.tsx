import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { RouterProvider, createMemoryHistory, createRouter } from "@tanstack/solid-router";
import { listen } from "@tauri-apps/api/event";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EVENTS } from "../../common/ipc/events";
import {
  SIDEBAR_WIDTH_DEFAULT,
  SIDEBAR_WIDTH_MAX,
  SIDEBAR_WIDTH_STORAGE_KEY,
  setSidebarWidth,
  sidebarCollapsed,
  toggleSidebar,
} from "../../common/stores/ui";
import { closeTaskViewer } from "../../common/stores/taskViewer";
import {
  clearNotifications,
  notifications,
} from "../../common/stores/notifications";
import * as namespacesApi from "../../features/namespaces/api";
import { resetNamespacesStore } from "../../features/namespaces/store";
import type { Namespace } from "../../features/namespaces/types";
import * as projectsApi from "../../features/projects/api";
import * as tasksApi from "../../features/tasks/api";
import { resetProjectsStore } from "../../features/projects/store";
import type { Project } from "../../features/projects/types";
import {
  installPage,
  resetTasksStore,
  setAll as setTasks,
  setUnfinishedCounts,
  tasksState,
} from "../../features/tasks/store";
import type { Task, TaskPage } from "../../features/tasks/types";
import { routeTree } from "../../router";

// The shell subscribes to backend events and loads both stores on mount.
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../features/namespaces/api", () => ({
  listNamespaces: vi.fn(),
  createNamespace: vi.fn(),
  updateNamespace: vi.fn(),
  archiveNamespace: vi.fn(),
  restoreNamespace: vi.fn(),
  deleteNamespace: vi.fn(),
}));

vi.mock("../../features/projects/api", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
  deleteProject: vi.fn(),
}));

vi.mock("../../features/tasks/api", () => ({
  listTasks: vi.fn().mockResolvedValue([]),
  listTasksByProject: vi.fn().mockResolvedValue({
    rows: [],
    children: [],
    related: [],
    blocked: [],
    hasMore: false,
    cursor: null,
  }),
  listUnfinishedCounts: vi.fn().mockResolvedValue([]),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  reorderTask: vi.fn(),
  listTags: vi.fn().mockResolvedValue([]),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listDependencies: vi.fn().mockResolvedValue([]),
  // The shell pulls the app-wide timer snapshot on mount (the rows' 开始/暂停);
  // without it the call throws and the error lands on the toaster.
  listRunningTimeEntries: vi.fn().mockResolvedValue([]),
}));

function namespace(id: string, name: string, status: "active" | "archived" = "active"): Namespace {
  return {
    id,
    name,
    description: null,
    color: null,
    icon: null,
    status,
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
  };
}

function project(
  id: string,
  name: string,
  overrides: Partial<Project> = {},
): Project {
  return {
    id,
    name,
    description: null,
    color: null,
    icon: null,
    namespaceId: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

/** A task due today, so the default view lists it and a drag can start there. */
function task(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: null,
    title: `任务 ${id}`,
    note: null,
    priority: "none",
    columnId: null,
    dueAt: new Date().toISOString(),
    completedAt: null,
    repeatRule: null,
    complexity: null,
    parentTaskId: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

/** 侧边栏的箭头读这一条聚合；测试把同一个数播种给 store 和挂载时的那次请求，
 * 断言就不靠「合并写不会抹掉已播种的值」这个副作用。 */
function seedUnfinished(projectId: string, unfinished: number) {
  setUnfinishedCounts([{ projectId, unfinished }]);
  vi.mocked(tasksApi.listUnfinishedCounts).mockResolvedValue([{ projectId, unfinished }]);
}

/** 触发外壳订阅的 `task:created`，就像 quick-add 小窗真的派发了一次。 */
function fireTaskCreated(): void {
  const handler = vi
    .mocked(listen)
    .mock.calls.find(([event]) => event === EVENTS.taskCreated)?.[1];
  if (!handler) throw new Error("外壳没有订阅 task:created");
  handler({} as never);
}

function renderShell() {
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/today"] }),
  });
  render(() => <RouterProvider router={router} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  // `clearAllMocks` 清调用但不清实现，所以计数聚合的默认值在这里重新钉一次：
  // 每条测试都从「服务端说没有未完成项」开始，不被上一条的播种带过去。
  vi.mocked(tasksApi.listUnfinishedCounts).mockResolvedValue([]);
  resetProjectsStore();
  resetNamespacesStore();
  resetTasksStore();
  clearNotifications();
  closeTaskViewer();
  // The width signal is module-level and persisted; without this, a resize
  // test's leftover width becomes the next test's starting width.
  localStorage.removeItem(SIDEBAR_WIDTH_STORAGE_KEY);
  setSidebarWidth(SIDEBAR_WIDTH_DEFAULT);
});

afterEach(cleanup);

describe("the brand mark", () => {
  /*
   * Three files, one drawing:
   *
   *   logo.svg, logo-square.svg   the mark itself, drawn as SVG circles — a disc
   *                               with its middle and its top right cut away, and
   *                               the accent dot in that gap. Byte-identical
   *                               copies. The sidebar renders the first; this is
   *                               also the favicon, the source of the packaged
   *                               icon set and the source of both runtime icons.
   *   logo-dark.svg               the same coordinates in the dark theme's ink,
   *                               generated by `scripts/gen-logo-assets.mjs`.
   *                               Geometry must be IDENTICAL — only ink may
   *                               differ, or it is a different drawing.
   *
   * Nothing here is traced from a bitmap any more: the numbers below are the
   * measured geometry of the export that was, and every size from the 28px
   * sidebar to the 512px bundle icon is rendered from them. `cargo test --lib
   * icons` checks the same pair from the other side.
   */
  const root = process.cwd();
  const dir = join(root, "src", "assets");
  const read = (name: string) => readFileSync(join(dir, name), "utf8");

  /** The attributes of the circle carrying `marker`, as a plain object. */
  const attrs = (svg: string, marker: string) => {
    const tag = svg.match(new RegExp(`<circle[^>]*${marker}[^>]*>`))?.[0] ?? "";
    return Object.fromEntries(
      [...tag.matchAll(/(cx|cy|r|fill)="([^"]*)"/g)].map((m) => [m[1], m[2]]),
    );
  };
  /** The ring: the disc the mask cuts, the only element carrying the ring's ink. */
  const ring = (svg: string) => attrs(svg, 'fill="#000000"');
  /** The dot: the filled circle, the only accent in the file. */
  const dot = (svg: string) => attrs(svg, 'fill="#24C68C"');

  /** The most common fully opaque colour: the ink, the accent covers less. */
  const dominant = (bytes: string) => {
    const counts = new Map<string, number>();
    for (let i = 0; i < bytes.length; i += 4) {
      if (bytes.charCodeAt(i + 3) !== 255) continue;
      const colour = bytes.slice(i, i + 3);
      counts.set(colour, (counts.get(colour) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  };

  it("keeps the light and square copies byte-identical", () => {
    expect(read("logo-square.svg"), "logo-square.svg drifted from logo.svg").toBe(
      read("logo.svg"),
    );
    // Pin the artwork. If this fails, someone redrew the mark: that may be
    // deliberate, but it needs a regenerated dark copy and icon set
    // (`node scripts/gen-logo-assets.mjs`) rather than passing silently.
    expect(ring(read("logo.svg")), "the mark's ring changed shape").toEqual({
      cx: "250.51",
      cy: "259.69",
      r: "213.91",
      fill: "#000000",
    });
    expect(dot(read("logo.svg")), "the mark's dot changed shape").toEqual({
      cx: "375.67",
      cy: "115.07",
      r: "61.92",
      fill: "#24C68C",
    });
  });

  it("carries vector geometry rather than an embedded bitmap", () => {
    // The version this replaced was a 500x500 PNG in an SVG wrapper: crisp at
    // 500px and staircased everywhere else. A bitmap here is that regression.
    for (const name of ["logo.svg", "logo-square.svg", "logo-dark.svg"]) {
      const svg = read(name);
      expect(svg.includes("base64,"), `${name} embeds a bitmap`).toBe(false);
      expect(svg.includes("<image"), `${name} draws an <image>`).toBe(false);
    }
    // The cuts are a mask: the ring is one filled circle, and the gap the dot
    // sits in is a circle on the dot's own centre — so the gap follows the dot
    // instead of being a place someone once measured.
    const svg = read("logo.svg");
    const accent = dot(svg);
    expect(svg, "the ring is not cut by the mask").toContain('mask="url(#cuts)"');
    const cuts = svg.match(/<mask[^>]*>[\s\S]*?<\/mask>/)?.[0] ?? "";
    expect(cuts, "the gap is not the dot's own circle").toContain(
      `<circle cx="${accent.cx}" cy="${accent.cy}"`,
    );
    // And it is wider than the dot, which is what leaves the dot a gap to sit in.
    const gap = cuts.split("<circle").find((part) => part.includes(`cx="${accent.cx}"`));
    const cut = Number(gap?.match(/ r="([\d.]+)"/)?.[1]);
    expect(cut, "the gap no longer clears the dot").toBeGreaterThan(Number(accent.r));
  });

  it("re-inks the dark copy without moving a single coordinate", () => {
    // Same file, one string different: the ring's ink. Anything else — a moved
    // centre, a different gap — makes the two variants different drawings.
    const light = read("logo.svg");
    const dark = read("logo-dark.svg");
    expect(dark.replace('fill="#EDE6E5"', 'fill="#000000"')).toBe(light);
    expect(dot(dark)).toEqual(dot(light));
  });

  it("rasterises both theme icons from that one drawing", () => {
    // 128x128 raw RGBA, embedded by icons.rs and set on the window and the tray.
    // latin1 so one character is one byte: the buffer is binary, and this file
    // has no node typings for a `Buffer` (the frontend never sees one).
    const raster = (name: string) =>
      readFileSync(join(root, "src-tauri", "icons", "runtime", `${name}.rgba`), "latin1");
    const light = raster("light");
    const dark = raster("dark");
    expect(light.length, "light.rgba is not one 128x128 RGBA image").toBe(128 * 128 * 4);
    expect(dark.length, "dark.rgba is not one 128x128 RGBA image").toBe(128 * 128 * 4);

    // No background, so the corner is clear in both.
    expect(light.charCodeAt(3), "the light icon has an opaque corner").toBe(0);
    expect(dark.charCodeAt(3), "the dark icon has an opaque corner").toBe(0);

    // One drawing, two inks: identical coverage, different colour where the ink
    // shows. A regeneration that fed both variants the same file fails here.
    let coverage = true;
    let differing = 0;
    for (let i = 0; i < light.length; i += 4) {
      if (light.charCodeAt(i + 3) !== dark.charCodeAt(i + 3)) coverage = false;
      if (light.slice(i, i + 3) !== dark.slice(i, i + 3)) differing++;
    }
    expect(coverage, "the two icons cover different pixels").toBe(true);
    expect(differing, "both icons carry the same ink").toBeGreaterThan(0);

    // And the right way round: light chrome gets the dark ink, and the reverse.
    // Swapping the two files would otherwise be invisible to every check.
    expect(
      dominant(light).charCodeAt(0),
      "the light icon does not carry the black ink",
    ).toBeLessThan(32);
    expect(
      dominant(dark).charCodeAt(0),
      "the dark icon does not carry the bone ink",
    ).toBeGreaterThan(200);
  });

  it("renders both theme copies from the files rather than redrawing inline", () => {
    const shell = readFileSync(join(root, "src", "app", "AppShell.tsx"), "utf8");
    expect(shell).toMatch(/import\s+logoSrc\s+from\s+"\.\.\/assets\/logo\.svg"/);
    expect(shell).toMatch(/import\s+logoDarkSrc\s+from\s+"\.\.\/assets\/logo-dark\.svg"/);
    // The swap is CSS, not JS: both images are in the DOM and `dark:` picks one.
    expect(shell).toMatch(/<img\s+src=\{logoSrc\}[^/]*dark:hidden/);
    expect(shell).toMatch(/<img\s+src=\{logoDarkSrc\}[^/]*dark:block/);
  });
});

describe("AppShell sidebar", () => {
  it("nests a namespace's projects and keeps ungrouped ones at the root", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([
      namespace("ns1", "工作"),
      namespace("ns2", "学习"),
    ]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "网站改版", { namespaceId: "ns1" }),
      project("p2", "移动端", { namespaceId: "ns1" }),
      project("p3", "读论文", { namespaceId: "ns2" }),
      project("p4", "杂事"),
    ]);
    renderShell();

    const group = await screen.findByRole("navigation", { name: "工作 的项目" });
    expect(group.textContent).toContain("网站改版");
    expect(group.textContent).toContain("移动端");
    expect(group.textContent).not.toContain("读论文");
    expect(group.textContent).not.toContain("杂事");
    // R1: the nested nav takes the one shared indent token, not a hand-rolled
    // margin/border/padding trio that could drift from the task list's step.
    expect(group.className).toContain("child-indent");
    expect(group.className).not.toContain("ml-3.5");

    // Unfiled projects stay in the flat root list, exactly as before.
    const root = screen.getByRole("navigation", { name: "项目列表" });
    expect(root.textContent).toContain("杂事");
    expect(root.textContent).not.toContain("网站改版");
  });

  // R8: 展开箭头占的是自己左边那一列，父行内容不再被它推到和子项同一列上 ——
  // 28px 的 `iconButtonClass` 箭头加 2px gap 正好等于 `child-indent` 的 30px。
  it("keeps a group's own row off its children's column", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "网站改版", { namespaceId: "ns1" }),
    ]);
    renderShell();

    const row = (await screen.findByRole("link", { name: /工作/ })).closest("div") as HTMLElement;
    // The chevron's slot hangs in the sidebar's own gutter, so the group's icon
    // and name keep the level-0 column; only the children take the indent.
    expect(row.classList.contains("-ml-2")).toBe(true);
    expect(row.classList.contains("child-indent")).toBe(false);

    const group = screen.getByRole("navigation", { name: "工作 的项目" });
    expect(group.className).toContain("child-indent");

    // A nested project pulls its own slot onto the guide line, which leaves the
    // row's content exactly where it was before the row became expandable.
    const nested = screen
      .getByRole("link", { name: "网站改版" })
      .closest("div") as HTMLElement;
    expect(nested.classList.contains("-ml-2.5")).toBe(true);
    expect(nested.classList.contains("child-indent")).toBe(false);
  });

  // 外壳的两处接线：挂载时取一次计数，quick-add 派发 `task:created` 时再取一次。
  // 两处都没有断言的话，删掉任何一个（或那行 `listen`）测试仍然是绿的。
  it("loads the unfinished counts on mount and re-reads them on task:created", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    renderShell();

    await waitFor(() => expect(tasksApi.listUnfinishedCounts).toHaveBeenCalledTimes(1));
    const taskLoadsBefore = vi.mocked(tasksApi.listTasks).mock.calls.length;

    fireTaskCreated();

    await waitFor(() => expect(tasksApi.listUnfinishedCounts).toHaveBeenCalledTimes(2));
    // 另一个窗口写的行在这一边的 store 里根本不存在，所以这一笔也要重载整棵树。
    await waitFor(() =>
      expect(vi.mocked(tasksApi.listTasks).mock.calls.length).toBeGreaterThan(taskLoadsBefore),
    );
  });

  // R9: 项目行可展开，列出该项目「顶层 + 未完成」的任务。
  it("expands a project row into its top-level unfinished tasks", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "杂事"),
      project("p2", "别的"),
    ]);
    // Loaded by the shell itself: the sidebar cannot wait for a task view.
    vi.mocked(tasksApi.listTasks).mockResolvedValue([
      task("t1", { projectId: "p1", title: "写周报" }),
      task("t2", { projectId: "p1", title: "已完成的", completedAt: "2026-09-15T10:00:00Z" }),
      task("t3", { projectId: "p1", title: "子任务", parentTaskId: "t1" }),
      task("t4", { projectId: "p2", title: "别的任务" }),
      task("t5", { title: "收件箱任务" }),
    ]);
    // 箭头读计数聚合、列表读项目自己的范围：两样都直接播种，省掉往返。
    seedUnfinished("p1", 1);
    installPage(
      "project:p1",
      {
        rows: [
          task("t1", { projectId: "p1", title: "写周报" }),
          task("t2", { projectId: "p1", title: "已完成的", completedAt: "2026-09-15T10:00:00Z" }),
          task("t3", { projectId: "p1", title: "子任务", parentTaskId: "t1" }),
        ],
        children: [],
        related: [],
        blocked: [],
        hasMore: false,
        cursor: null,
      },
      false,
    );
    renderShell();

    fireEvent.click(await screen.findByRole("button", { name: "展开项目 杂事" }));

    const list = await screen.findByRole("navigation", { name: "杂事 的未完成任务" });
    expect(list.textContent).toContain("写周报");
    expect(list.textContent).not.toContain("已完成的");
    expect(list.textContent).not.toContain("子任务");
    expect(list.textContent).not.toContain("别的任务");
    expect(list.textContent).not.toContain("收件箱任务");

    // Collapsed by default, and each row opens its own list.
    expect(screen.queryByRole("navigation", { name: "别的 的未完成任务" })).toBeNull();
    expect(screen.getByRole("button", { name: "收起项目 杂事" }).getAttribute("aria-expanded")).toBe(
      "true",
    );
  });

  it("offers no disclosure for a project with nothing left to do", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(tasksApi.listTasks).mockResolvedValue([
      task("t1", { projectId: "p1", completedAt: "2026-09-15T10:00:00Z" }),
      task("t2", { projectId: "p1", parentTaskId: "t1" }),
      // 快照里确实留着一行顶层未完成：只有聚合的 0 能把箭头关掉，所以从快照
      // 里数箭头的实现会在这里长出按钮、让这一条失败。
      task("t3", { projectId: "p1", title: "还没做的" }),
    ]);
    seedUnfinished("p1", 0);
    renderShell();

    await screen.findByRole("link", { name: "杂事" });
    // Wait for the shell's task load, or the absence below proves nothing.
    await waitFor(() => expect(tasksState.loaded).toBe(true));
    // The disclosure arrow is what must be gone; the row still carries its ＋
    // (R11), so the name matches the arrow's own wording, not the row's.
    expect(screen.queryByRole("button", { name: /(收起|展开)项目 杂事/ })).toBeNull();
  });

  it("opens the task detail from a task row in the tree", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(tasksApi.listTasks).mockResolvedValue([
      task("t1", { projectId: "p1", title: "写周报" }),
    ]);
    seedUnfinished("p1", 1);
    installPage(
      "project:p1",
      {
        rows: [task("t1", { projectId: "p1", title: "写周报" })],
        children: [],
        related: [],
        blocked: [],
        hasMore: false,
        cursor: null,
      },
      false,
    );
    renderShell();

    fireEvent.click(await screen.findByRole("button", { name: "展开项目 杂事" }));
    // The same task is also a row in 今天, so the click has to start on the
    // sidebar's own copy.
    const list = await screen.findByRole("navigation", { name: "杂事 的未完成任务" });
    fireEvent.click(within(list).getByRole("button", { name: "写周报" }));

    expect(screen.getByRole("dialog").textContent).toContain("写周报");
  });

  it("展开项目时按需装载它的范围，列表不来自全量快照", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(tasksApi.listTasksByProject).mockResolvedValue({
      rows: [task("t1", { projectId: "p1", title: "买菜" })],
      children: [],
      related: [],
      blocked: [],
      hasMore: false,
      cursor: null,
    });
    seedUnfinished("p1", 1);
    // 快照里没有这一行：标题只能来自范围。
    setTasks([], []);

    renderShell();
    fireEvent.click(await screen.findByRole("button", { name: "展开项目 杂事" }));

    const list = await screen.findByRole("navigation", { name: "杂事 的未完成任务" });
    expect(within(list).getByText("买菜")).toBeTruthy();
    expect(tasksApi.listTasksByProject).toHaveBeenCalledWith("p1");
  });

  // 展开到列表出现之间隔着一次往返：那一段既没内容也没加载提示，所以那个带
  // 名字的 landmark 不该先画出来再填。
  it("范围还在装载时不画那个空的未完成列表", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    let settle: (page: TaskPage) => void = () => {};
    vi.mocked(tasksApi.listTasksByProject).mockReturnValue(
      new Promise<TaskPage>((resolve) => {
        settle = resolve;
      }),
    );
    seedUnfinished("p1", 1);
    renderShell();

    fireEvent.click(await screen.findByRole("button", { name: "展开项目 杂事" }));
    expect(tasksState.scopeMeta["project:p1"]?.loading).toBe(true);
    expect(screen.queryByRole("navigation", { name: "杂事 的未完成任务" })).toBeNull();

    settle({
      rows: [task("t1", { projectId: "p1", title: "写周报" })],
      children: [],
      related: [],
      blocked: [],
      hasMore: false,
      cursor: null,
    });

    const list = await screen.findByRole("navigation", { name: "杂事 的未完成任务" });
    expect(within(list).getByText("写周报")).toBeTruthy();
  });

  it("lists an archived namespace's projects under it, not in the flat archive", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([
      namespace("ns1", "工作"),
      namespace("ns2", "旧线", "archived"),
    ]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "归档项目", { status: "archived" }),
      project("p2", "旧线项目", { namespaceId: "ns2" }),
      project("p3", "旧线归档项目", { namespaceId: "ns2", status: "archived" }),
    ]);
    renderShell();

    // Expand the archived section.
    const toggle = await screen.findByRole("button", { name: /已归档/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();

    const group = await screen.findByRole("navigation", { name: "旧线 的项目" });
    expect(group.textContent).toContain("旧线项目");
    expect(group.textContent).toContain("旧线归档项目");

    const flat = screen.getByRole("navigation", { name: "已归档项目" });
    expect(flat.textContent).toContain("归档项目");
    expect(flat.textContent).not.toContain("旧线项目");
    // `归档项目` is a substring of `旧线归档项目`, so the positive assertion
    // above cannot see a flat list wired to the archived namespace's projects:
    // that list would drop the unfiled project and duplicate this one.
    expect(flat.textContent).not.toContain("旧线归档项目");
  });

  it("shows no namespace rows when there are none", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    renderShell();

    await screen.findByText("杂事");
    expect(screen.queryByRole("navigation", { name: "命名空间列表" })).toBeNull();
  });

  // R4: 两个创建入口都是「标题 ＋」，命名空间不再是列表下方的整宽按钮。
  it("offers 项目 ＋ and 命名空间 ＋ as sibling headers", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([]);
    renderShell();

    const createProject = await screen.findByRole("button", { name: "新建项目" });
    const createNamespace = screen.getByRole("button", { name: "新建命名空间" });

    // Same header shape: a label row with the ＋ on its right.
    for (const button of [createProject, createNamespace]) {
      expect(button.parentElement?.textContent).toMatch(/项目|命名空间/);
    }
    expect(screen.queryByRole("button", { name: "＋ 新建命名空间" })).toBeNull();

    createNamespace.click();
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("drops the namespace chevron in the collapsed rail", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([]);
    renderShell();

    await screen.findByRole("button", { name: "收起命名空间 工作" });
    toggleSidebar();

    // Collapsed there is no nested nav to open, so the toggle is dead weight —
    // and the row is the icon alone, with the project rows' `size-8` geometry
    // rather than a `flex-1` basis that would squeeze it to a few pixels.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /命名空间 工作/ })).toBeNull(),
    );
    expect(screen.getByRole("link", { name: "工作" }).getAttribute("class")).not.toContain(
      "flex-1",
    );

    // The collapse signal is module-level: leave it expanded for later tests.
    toggleSidebar();
    await waitFor(() => expect(sidebarCollapsed()).toBe(false));
  });

  // R7a: 拖项目行到命名空间行 = 归入该命名空间；拖到根级项目区 = 移出命名空间。
  it("files a dragged project into a namespace, and unfiles it on the root list", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(projectsApi.updateProject).mockResolvedValue(
      project("p1", "杂事", { namespaceId: "ns1" }),
    );
    renderShell();

    const row = await screen.findByRole("link", { name: "杂事" });
    expect(row.getAttribute("draggable")).toBe("true");

    fireEvent.dragStart(row);
    // Expanded, the row also carries the project count, so match on the name.
    const group = screen.getByRole("link", { name: /工作/ }).closest("div") as HTMLElement;
    fireEvent.dragOver(group);
    fireEvent.drop(group);

    await waitFor(() =>
      expect(projectsApi.updateProject).toHaveBeenCalledWith("p1", { namespaceId: "ns1" }),
    );

    // Same drag, dropped on the root list, moves it back out.
    fireEvent.dragStart(row);
    const root = screen.getByRole("navigation", { name: "项目列表" });
    fireEvent.dragOver(root);
    fireEvent.drop(root);

    await waitFor(() =>
      expect(projectsApi.updateProject).toHaveBeenCalledWith("p1", { namespaceId: null }),
    );
  });

  // R7b/§9.4: 任务行拖到侧边栏项目行 = 移进该项目，同时脱离父任务 —— 因为用户
  // 以为只是换了项目，所以落地后要说一句。
  it("unfiles a dragged child task when it lands on a project row", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(tasksApi.updateTask).mockResolvedValue(task("t1", { projectId: "p1" }));
    renderShell();

    const target = await screen.findByRole("link", { name: "杂事" });
    setTasks([task("t1", { parentTaskId: "p9" })], []);

    // The child stands alone in 今天 (its parent is not in the view). The drag
    // has to start on *that row*: §9.4 is a user gesture, and starting it from
    // the store instead would test a path the UI cannot reach.
    const row = (await waitFor(() => {
      const element = document.querySelector('[data-subtask-id="t1"]');
      if (!element) throw new Error("task row not rendered yet");
      return element;
    })) as HTMLElement;

    fireEvent.dragStart(row);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(() =>
      expect(tasksApi.updateTask).toHaveBeenCalledWith("t1", {
        projectId: "p1",
        parentTaskId: null,
      }),
    );

    await waitFor(() => expect(notifications()).toHaveLength(1));
    expect(notifications()[0]?.message).toContain("移出父任务");
  });

  // R7b: 任务行拖到侧边栏项目行 = 把任务移进该项目。顶层任务没有父子关系可断，
  // 所以这一路不发通知。
  it("moves a dragged task into the project row it is dropped on", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    vi.mocked(tasksApi.updateTask).mockResolvedValue(task("t1", { projectId: "p1" }));
    renderShell();

    const target = await screen.findByRole("link", { name: "杂事" });
    setTasks([task("t1")], []);

    const row = (await waitFor(() => {
      const element = document.querySelector('[data-task-id="t1"]');
      if (!element) throw new Error("task row not rendered yet");
      return element;
    })) as HTMLElement;

    fireEvent.dragStart(row);
    fireEvent.dragOver(target);
    fireEvent.drop(target);

    await waitFor(() =>
      expect(tasksApi.updateTask).toHaveBeenCalledWith("t1", {
        projectId: "p1",
        parentTaskId: null,
      }),
    );
    expect(notifications()).toHaveLength(0);
  });

  it("ignores a drop that carries nothing we started", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    renderShell();

    const group = (await screen.findByRole("link", { name: /工作/ })).closest("div") as HTMLElement;
    // A file dragged in from the OS, or the board's own column drag.
    fireEvent.drop(group);

    expect(projectsApi.updateProject).not.toHaveBeenCalled();
  });
});

/*
 * The route-change transition used to flash a scrollbar. The wrapper that
 * carries `animate-view-in` is exactly as tall as the content area, and a
 * `translate` on a box inside a scroll container extends that container's
 * scrollable overflow by the travel distance — so each switch painted a 15px
 * gutter and shoved the view sideways for the 200ms, which also drowned out the
 * rise it was supposed to show. The fix is positional: the clip goes one level
 * up (on `<main>`) and the scrolling one level down (on the animated box).
 *
 * jsdom does no layout, so there is no scrollbar to observe here; what is
 * asserted is the arrangement that leaves the translate nothing to scroll.
 */
describe("the view transition", () => {
  it("keeps the animated view wrapper outside any scroll container", async () => {
    renderShell();

    const main = await screen.findByRole("main");
    expect(main.id).toBe("ordo-main");
    expect(main.className).toContain("overflow-hidden");

    const wrapper = main.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain("animate-view-in");
    // The animated box is the scroller itself, or a view taller than the window
    // would have nothing left to scroll it.
    expect(wrapper.className).toContain("overflow-y-auto");
    expect(wrapper.className).toContain("h-full");
  });
});

/*
 * R10/R11: the rail's width is adjustable and every active tree row carries a
 * ＋ that creates inside it. The archived rows keep their 恢复 button instead —
 * the trailing slot is one button wide, and creating into an archived container
 * is not a thing the sidebar should offer.
 */
describe("the sidebar rail and its row ＋", () => {
  it("creates a project in the namespace and a task in the project from the row ＋", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "网站改版", { namespaceId: "ns1" }),
      project("p2", "杂事"),
    ]);
    renderShell();

    // The namespace row's ＋ opens the project dialog already filed into it…
    fireEvent.click(await screen.findByRole("button", { name: "在命名空间 工作 中新建项目" }));
    const projectDialog = await screen.findByRole("dialog");
    expect(projectDialog.textContent).toContain("新建项目");
    expect(within(projectDialog).getByText("工作"), "the namespace was not preselected").toBeTruthy();

    fireEvent.click(within(projectDialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    // …and the project row's ＋ opens the task dialog already inside it, for
    // nested and root-level rows alike.
    fireEvent.click(screen.getByRole("button", { name: "在项目 网站改版 中新建任务" }));
    const taskDialog = await screen.findByRole("dialog");
    expect(taskDialog.textContent).toContain("新建任务");
    expect(within(taskDialog).getByText("网站改版"), "the project was not preselected").toBeTruthy();
    fireEvent.click(within(taskDialog).getByRole("button", { name: "取消" }));
  });

  it("offers no row ＋ in the archived section, only the restore buttons", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([
      namespace("ns1", "旧线", "archived"),
    ]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "归档项目", { status: "archived" }),
    ]);
    renderShell();

    fireEvent.click(await screen.findByRole("button", { name: /已归档/ }));

    await screen.findByRole("button", { name: "恢复命名空间 旧线" });
    expect(screen.queryByRole("button", { name: "在命名空间 旧线 中新建项目" })).toBeNull();
    expect(screen.queryByRole("button", { name: "在项目 归档项目 中新建任务" })).toBeNull();
    // R13: 归档行不给 ⋯ 菜单 —— 归档的可逆动作就是「恢复」，行尾一个按钮。
    expect(screen.queryByRole("button", { name: /更多操作/ })).toBeNull();
  });

  it("drops the row ＋ and the resize handle in the collapsed rail", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "网站改版", { namespaceId: "ns1" }),
    ]);
    renderShell();

    await screen.findByRole("button", { name: "在命名空间 工作 中新建项目" });
    toggleSidebar();
    await waitFor(() => expect(sidebarCollapsed()).toBe(true));

    // The 52px rail has no room for a trailing button and no width worth
    // adjusting — neither the ＋ nor the handle renders.
    expect(screen.queryByRole("button", { name: /中新建/ })).toBeNull();
    expect(screen.queryByRole("separator", { name: "调整侧边栏宽度" })).toBeNull();

    // The collapse signal is module-level: leave it expanded for later tests.
    toggleSidebar();
    await waitFor(() => expect(sidebarCollapsed()).toBe(false));
  });

  it("widens the rail from the keyboard, clamps at the bounds, and resets on double-click", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([]);
    renderShell();

    const handle = await screen.findByRole("separator", { name: "调整侧边栏宽度" });
    expect(handle.getAttribute("aria-valuenow")).toBe(String(SIDEBAR_WIDTH_DEFAULT));

    fireEvent.keyDown(handle, { key: "ArrowRight" });
    expect(handle.getAttribute("aria-valuenow")).toBe(String(SIDEBAR_WIDTH_DEFAULT + 16));

    fireEvent.keyDown(handle, { key: "End" });
    expect(handle.getAttribute("aria-valuenow")).toBe(String(SIDEBAR_WIDTH_MAX));

    fireEvent.dblClick(handle);
    expect(handle.getAttribute("aria-valuenow")).toBe(String(SIDEBAR_WIDTH_DEFAULT));
  });

  it("follows the pointer across a drag and stops animating while it does", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([]);
    renderShell();

    const handle = await screen.findByRole("separator", { name: "调整侧边栏宽度" });
    const rail = screen.getByRole("complementary", { name: "侧边栏导航" });

    fireEvent.pointerDown(handle, { clientX: 300, pointerId: 1 });
    // A transitioned width trails the cursor, so the rail drops the transition
    // for the length of the drag (see `SIDEBAR_RAIL_CLASS`).
    expect(rail.classList.contains("transition-[width]")).toBe(false);

    fireEvent.pointerMove(handle, { clientX: 372, pointerId: 1 });
    expect(handle.getAttribute("aria-valuenow")).toBe(String(SIDEBAR_WIDTH_DEFAULT + 72));

    fireEvent.pointerUp(handle, { pointerId: 1 });
    expect(rail.classList.contains("transition-[width]")).toBe(true);
    // What the drag wrote is what the next launch reads.
    expect(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY)).toBe(
      String(SIDEBAR_WIDTH_DEFAULT + 72),
    );
  });
});

/*
 * R13: 每个存活行的行尾是 [编辑][⋯ 归档/删除][＋]。编辑打开与详情页同一个
 * 弹窗（免导航改名/换色）；⋯ 里的归档走乐观翻转，删除走乐观移除 —— 命名空间
 * 删除只删自己（项目按存活集合回落根级），项目删除连带它的任务。
 */
describe("the sidebar rows' edit and ⋯ menu", () => {
  it("opens the editors prefilled from the ⋯ menu's 编辑 item", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "网站改版", { namespaceId: "ns1" }),
    ]);
    renderShell();

    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "命名空间 工作的更多操作" }),
    );
    fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "编辑" }));
    const nsDialog = await screen.findByRole("dialog");
    expect(nsDialog.textContent).toContain("编辑命名空间");
    expect((within(nsDialog).getByLabelText("名称") as HTMLInputElement).value).toBe("工作");
    fireEvent.click(within(nsDialog).getByRole("button", { name: "取消" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    fireEvent.pointerDown(screen.getByRole("button", { name: "项目 网站改版的更多操作" }));
    fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "编辑" }));
    const projectDialog = await screen.findByRole("dialog");
    expect(projectDialog.textContent).toContain("编辑项目");
    expect(
      (within(projectDialog).getByLabelText("名称") as HTMLInputElement).value,
    ).toBe("网站改版");
    fireEvent.click(within(projectDialog).getByRole("button", { name: "取消" }));
  });

  it("archives a namespace and a project from the row's ⋯ menu", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "网站改版", { namespaceId: "ns1" }),
    ]);
    vi.mocked(namespacesApi.archiveNamespace).mockResolvedValue(
      namespace("ns1", "工作", "archived"),
    );
    vi.mocked(projectsApi.archiveProject).mockResolvedValue(
      project("p1", "网站改版", { status: "archived" }),
    );
    renderShell();

    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "项目 网站改版的更多操作" }),
    );
    fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "归档" }));
    await waitFor(() => expect(projectsApi.archiveProject).toHaveBeenCalledWith("p1"));

    fireEvent.pointerDown(screen.getByRole("button", { name: "命名空间 工作的更多操作" }));
    fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "归档" }));
    await waitFor(() => expect(namespacesApi.archiveNamespace).toHaveBeenCalledWith("ns1"));
  });

  it("overlays the trailing actions instead of reserving row width", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([project("p1", "杂事")]);
    renderShell();

    const plus = await screen.findByRole("button", { name: "在项目 杂事 中新建任务" });
    const cluster = plus.parentElement as HTMLElement;
    const row = cluster.parentElement as HTMLElement;

    // R13 修订：三个 28px 按钮放进流里会永久占掉 84px 行宽 —— 侧边栏收到
    // 192px 下限时，嵌套行的名称只剩 ~17px，窄行时按钮还会与文字真实重叠
    // （浏览器实测复现）。动作簇因此改为贴行右缘的覆盖层：名称独占整行宽，
    // 悬停/Tab 聚焦/菜单展开时整簇带与行一致的底色浮现，盖住名称尾部；
    // 隐藏时簇与按钮都不接指针事件，点击与拖放照常落在行链接上。
    expect(cluster.className).toContain("absolute");
    expect(cluster.className).toContain("pointer-events-none");
    expect(row.className).toContain("relative");
    expect(plus.className).toContain("group-hover:pointer-events-auto");
  });

  it("deletes a project (with its row) and a namespace from the row's ⋯ menu", async () => {
    vi.mocked(namespacesApi.listNamespaces).mockResolvedValue([namespace("ns1", "工作")]);
    vi.mocked(projectsApi.listProjects).mockResolvedValue([
      project("p1", "网站改版", { namespaceId: "ns1" }),
      project("p2", "留下项目", { namespaceId: "ns1" }),
    ]);
    vi.mocked(projectsApi.deleteProject).mockResolvedValue(undefined);
    vi.mocked(namespacesApi.deleteNamespace).mockResolvedValue(undefined);
    renderShell();

    fireEvent.pointerDown(
      await screen.findByRole("button", { name: "项目 网站改版的更多操作" }),
    );
    fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "删除" }));
    await waitFor(() => expect(projectsApi.deleteProject).toHaveBeenCalledWith("p1"));
    // The optimistic step hides the row at once; its sibling stays.
    await waitFor(() => expect(screen.queryByRole("link", { name: "网站改版" })).toBeNull());
    expect(screen.getByRole("link", { name: "留下项目" })).toBeTruthy();

    // The namespace delete keeps its remaining projects: they fall back to the
    // root list by the live-set rule, which is the store's own behaviour.
    fireEvent.pointerDown(screen.getByRole("button", { name: "命名空间 工作的更多操作" }));
    fireEvent.pointerUp(await screen.findByRole("menuitem", { name: "删除" }));
    await waitFor(() => expect(namespacesApi.deleteNamespace).toHaveBeenCalledWith("ns1"));
    await waitFor(() =>
      expect(screen.queryByRole("navigation", { name: "命名空间列表" })).toBeNull(),
    );
    expect(screen.getByRole("link", { name: "留下项目" })).toBeTruthy();
  });
});

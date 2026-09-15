/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../common/components/__tests__/setup";
import { EVENTS } from "../../common/ipc/events";
import * as api from "../../features/tasks/api";
import { resetTasksStore } from "../../features/tasks/store";
import * as projectsApi from "../../features/projects/api";
import { projectsState, resetProjectsStore } from "../../features/projects/store";
import type { Project } from "../../features/projects/types";
import QuickAddWindow from "../QuickAddWindow";

const listenMock = vi.fn();
const emitMock = vi.fn();
const hideMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
  emit: (...args: unknown[]) => emitMock(...args),
}));

vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ hide: (...args: unknown[]) => hideMock(...args) }),
}));

vi.mock("../../features/tasks/api", () => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  completeTask: vi.fn(),
  softDeleteTask: vi.fn(),
  restoreTask: vi.fn(),
  reorderTask: vi.fn(),
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  listDependencies: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../features/projects/api", () => ({
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  archiveProject: vi.fn(),
  restoreProject: vi.fn(),
}));

function projectFixture(id: string, name: string): Project {
  return {
    id,
    name,
    description: null,
    color: null,
    icon: null,
    namespaceId: null,
    status: "active",
    sortOrder: id,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    deletedAt: null,
  };
}

const PROJECTS = [projectFixture("p-work", "Work"), projectFixture("p-home", "个人")];

function createdTask(title: string) {
  return {
    id: "t-new",
    projectId: null,
    title,
    note: null,
    priority: "none" as const,
    columnId: null,
    dueAt: null,
    completedAt: null,
    repeatRule: null,
    complexity: null,
    parentTaskId: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-09-11T10:00:00Z",
    updatedAt: "2026-09-11T10:00:00Z",
    deletedAt: null,
  };
}

/** The payload the window actually sends: explicit resolved fields. */
function payload(overrides: Record<string, unknown> = {}) {
  return { projectId: null, priority: "none", dueAt: null, ...overrides };
}

/** Tomorrow at a wall-clock time, in the zone the test runs in. */
function tomorrowAt(hour: number, minute: number): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  date.setHours(hour, minute, 0, 0);
  return date.toISOString();
}

/** Fires the event the backend emits when it surfaces the window. */
function showWindow(): void {
  const handler = listenMock.mock.calls[0]?.[1] as (() => void) | undefined;
  handler?.();
}

/** Renders the window and waits for its subscription and project list. */
async function renderWindow() {
  const view = render(() => <QuickAddWindow />);
  await waitFor(() => expect(listenMock).toHaveBeenCalledWith(EVENTS.quickAdd, expect.any(Function)));
  await waitFor(() => expect(projectsState.loaded).toBe(true));
  return view;
}

async function pickProject(name: string): Promise<void> {
  // The Select.Label names the trigger ("项目") via aria-labelledby.
  fireEvent.pointerDown(screen.getByRole("button", { name: /项目/ }));
  fireEvent.click(await screen.findByRole("option", { name }));
}

async function pickPriority(label: string): Promise<void> {
  fireEvent.pointerDown(screen.getByRole("button", { name: /优先级/ }));
  fireEvent.click(await screen.findByRole("option", { name: label }));
}

beforeEach(() => {
  vi.clearAllMocks();
  listenMock.mockResolvedValue(() => {});
  emitMock.mockResolvedValue(undefined);
  hideMock.mockResolvedValue(undefined);
  vi.mocked(api.createTask).mockImplementation(async (input) => createdTask(input.title));
  vi.mocked(projectsApi.listProjects).mockResolvedValue(PROJECTS);
  resetTasksStore();
  resetProjectsStore();
});

afterEach(cleanup);

describe("QuickAddWindow", () => {
  it("clears the field and focuses the input whenever it is surfaced", async () => {
    await renderWindow();
    const input = screen.getByLabelText("任务标题") as HTMLInputElement;

    fireEvent.input(input, { target: { value: "半截输入" } });
    showWindow();

    expect(input.value).toBe("");
    expect(document.activeElement).toBe(input);
  });

  it("files the task into the inbox, tells the main window and hides", async () => {
    await renderWindow();
    const input = screen.getByLabelText("任务标题");

    fireEvent.input(input, { target: { value: "  写周报  " } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith({ title: "写周报", ...payload() }),
    );
    // The main window has its own store and cannot see this write.
    await waitFor(() => expect(emitMock).toHaveBeenCalledWith(EVENTS.taskCreated));
    // The window parks itself again, so the user lands back where they were.
    await waitFor(() => expect(hideMock).toHaveBeenCalledTimes(1));
  });

  it("files the project, priority and date named in the line", async () => {
    await renderWindow();
    const input = screen.getByLabelText("任务标题");

    fireEvent.input(input, { target: { value: "写周报 @Work !高 #明天下午3点" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith({
        title: "写周报",
        ...payload({ projectId: "p-work", priority: "high", dueAt: tomorrowAt(15, 0) }),
      }),
    );
  });

  it("leaves a date word alone when it has no # in front of it", async () => {
    await renderWindow();
    const input = screen.getByLabelText("任务标题");

    fireEvent.input(input, { target: { value: "月底前完成报表" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith({
        title: "月底前完成报表",
        ...payload(),
      }),
    );
  });

  it("keeps an @word that names no project in the title", async () => {
    await renderWindow();
    const input = screen.getByLabelText("任务标题");

    fireEvent.input(input, { target: { value: "等 @张三 回复" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith({
        title: "等 @张三 回复",
        ...payload(),
      }),
    );
  });

  it("previews what the line will file", async () => {
    await renderWindow();

    fireEvent.input(screen.getByLabelText("任务标题"), {
      target: { value: "写周报 @Work !高" },
    });

    await waitFor(() => {
      const preview = screen.getByRole("status").textContent ?? "";
      expect(preview).toContain("写周报");
      expect(preview).toContain("Work");
      expect(preview).toContain("高");
    });
  });

  it("falls back to the hint when the line names nothing", async () => {
    await renderWindow();

    fireEvent.input(screen.getByLabelText("任务标题"), { target: { value: "写周报" } });

    await waitFor(() =>
      expect(screen.getByRole("status").textContent).toContain("任务进入收件箱"),
    );
  });

  it("shows the resolved project on the control", async () => {
    await renderWindow();
    const trigger = () => screen.getByRole("button", { name: /项目/ });

    expect(trigger().textContent).toContain("收件箱");

    fireEvent.input(screen.getByLabelText("任务标题"), { target: { value: "写周报 @Work" } });
    await waitFor(() => expect(trigger().textContent).toContain("Work"));
  });

  it("takes a project from the control", async () => {
    await renderWindow();
    await pickProject("个人");

    fireEvent.input(screen.getByLabelText("任务标题"), { target: { value: "买菜" } });
    fireEvent.keyDown(screen.getByLabelText("任务标题"), { key: "Enter" });

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith({
        title: "买菜",
        ...payload({ projectId: "p-home" }),
      }),
    );
  });

  it("takes a priority from the control", async () => {
    await renderWindow();
    await pickPriority("中");

    fireEvent.input(screen.getByLabelText("任务标题"), { target: { value: "写周报" } });
    fireEvent.keyDown(screen.getByLabelText("任务标题"), { key: "Enter" });

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith({
        title: "写周报",
        ...payload({ priority: "medium" }),
      }),
    );
  });

  it("takes a due date from the control, as the end of that day", async () => {
    await renderWindow();

    fireEvent.input(screen.getByLabelText("截止日期"), { target: { value: "2026-09-20" } });
    fireEvent.input(screen.getByLabelText("任务标题"), { target: { value: "写周报" } });
    fireEvent.keyDown(screen.getByLabelText("任务标题"), { key: "Enter" });

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith({
        title: "写周报",
        ...payload({ dueAt: new Date(2026, 8, 20, 23, 59, 59).toISOString() }),
      }),
    );
  });

  it("lets a control override the marker", async () => {
    await renderWindow();
    const input = screen.getByLabelText("任务标题");

    fireEvent.input(input, { target: { value: "写周报 @Work" } });
    await pickProject("个人");
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() =>
      expect(api.createTask).toHaveBeenCalledWith({
        title: "写周报",
        ...payload({ projectId: "p-home" }),
      }),
    );
  });

  it("starts the next capture clean after a filed task", async () => {
    await renderWindow();

    await pickPriority("高");
    fireEvent.input(screen.getByLabelText("任务标题"), { target: { value: "第一条" } });
    fireEvent.keyDown(screen.getByLabelText("任务标题"), { key: "Enter" });
    await waitFor(() => expect(hideMock).toHaveBeenCalledTimes(1));

    showWindow();
    fireEvent.input(screen.getByLabelText("任务标题"), { target: { value: "第二条" } });
    fireEvent.keyDown(screen.getByLabelText("任务标题"), { key: "Enter" });

    await waitFor(() => expect(api.createTask).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.createTask).mock.calls[1][0]).toEqual({
      title: "第二条",
      ...payload(),
    });
  });

  it("keeps the title and the window when the task is rejected", async () => {
    vi.mocked(api.createTask).mockRejectedValue({ code: "validation", message: "标题不能为空" });
    await renderWindow();
    const input = screen.getByLabelText("任务标题") as HTMLInputElement;

    fireEvent.input(input, { target: { value: "写周报" } });
    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => expect(api.createTask).toHaveBeenCalled());
    expect(hideMock).not.toHaveBeenCalled();
    expect(input.value).toBe("写周报");
    // The failure is reported through the window's own Toaster.
    expect((await screen.findByRole("alert")).textContent).toContain("标题不能为空");
  });

  it("ignores a blank title", async () => {
    await renderWindow();
    const input = screen.getByLabelText("任务标题");

    fireEvent.input(input, { target: { value: "   " } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(api.createTask).not.toHaveBeenCalled();
    expect(hideMock).not.toHaveBeenCalled();
  });

  it("refuses a line that is nothing but markers", async () => {
    await renderWindow();
    const input = screen.getByLabelText("任务标题");

    fireEvent.input(input, { target: { value: "@Work !高 #明天" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(api.createTask).not.toHaveBeenCalled();
    expect(hideMock).not.toHaveBeenCalled();
  });

  it("hides without filing anything on Escape", async () => {
    await renderWindow();
    const input = screen.getByLabelText("任务标题");

    fireEvent.input(input, { target: { value: "算了吧" } });
    fireEvent.keyDown(input, { key: "Escape" });

    await waitFor(() => expect(hideMock).toHaveBeenCalledTimes(1));
    expect(api.createTask).not.toHaveBeenCalled();
    expect(emitMock).not.toHaveBeenCalled();
  });

  it("lets the IME take the Enter that commits a composition", async () => {
    await renderWindow();
    const input = screen.getByLabelText("任务标题") as HTMLInputElement;

    // A Chinese title mid-composition: Enter commits it in the IME, and the
    // task must wait for the next Enter rather than being filed half-typed.
    fireEvent.input(input, { target: { value: "写周报" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });

    expect(api.createTask).not.toHaveBeenCalled();
    expect(hideMock).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(api.createTask).toHaveBeenCalledWith({
      title: "写周报",
      ...payload(),
    }));
    await waitFor(() => expect(hideMock).toHaveBeenCalledTimes(1));
  });

  it("renders without a Tauri runtime (browser dev server)", async () => {
    listenMock.mockRejectedValue(new Error("no tauri"));
    render(() => <QuickAddWindow />);
    await waitFor(() => expect(listenMock).toHaveBeenCalled());
    expect(screen.getByLabelText("任务标题")).toBeTruthy();
  });
});

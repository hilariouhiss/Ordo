/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import { isoToLocalInputValue } from "../../../common/utils/datetime";
import { TaskEditorDialog } from "../components/TaskEditorDialog";
import * as hooks from "../hooks";
import * as store from "../store";
import type { Task } from "../types";

vi.mock("../hooks", () => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));

function taskFixture(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    projectId: null,
    title: `任务 ${id}`,
    note: null,
    priority: "none",
    columnId: null,
    dueAt: null,
    completedAt: null,
    repeatRule: null,
    tagIds: [],
    sortOrder: "n",
    createdAt: "2026-01-10T10:00:00Z",
    updatedAt: "2026-01-10T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function renderDialog(task?: Task) {
  const onOpenChange = vi.fn();
  render(() => (
    <TaskEditorDialog open={true} onOpenChange={onOpenChange} task={task} />
  ));
  return { onOpenChange };
}

async function selectPriority(label: string): Promise<void> {
  // The Select.Label names the trigger ("优先级") via aria-labelledby.
  fireEvent.pointerDown(screen.getByRole("button", { name: /优先级/ }));
  const option = await screen.findByRole("option", { name: label });
  fireEvent.click(option);
}

describe("TaskEditorDialog", () => {
  afterEach(cleanup);

  beforeEach(() => {
    vi.clearAllMocks();
    store.resetTasksStore();
    store.setAll(
      [],
      [
        {
          id: "t1",
          name: "工作",
          color: null,
          createdAt: "2026-01-10T10:00:00Z",
          updatedAt: "2026-01-10T10:00:00Z",
          deletedAt: null,
        },
        {
          id: "t2",
          name: "生活",
          color: "#00aa00",
          createdAt: "2026-01-10T10:00:00Z",
          updatedAt: "2026-01-10T10:00:00Z",
          deletedAt: null,
        },
      ],
    );
  });

  it("creates a task with trimmed title and defaults", async () => {
    vi.mocked(hooks.createTask).mockResolvedValue(taskFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("标题"), {
      target: { value: "  新任务  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(hooks.createTask).toHaveBeenCalledTimes(1);
    expect(hooks.createTask).toHaveBeenCalledWith({
      title: "新任务",
      note: null,
      priority: "none",
      dueAt: null,
      tagIds: [],
    });
  });

  it("shows a clear error and skips the backend for a blank title", async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByText("标题不能为空")).toBeTruthy();
    expect(hooks.createTask).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    // Fixing the field and resubmitting succeeds.
    vi.mocked(hooks.createTask).mockResolvedValue(taskFixture("new-1"));
    fireEvent.input(screen.getByLabelText("标题"), { target: { value: "有效标题" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("rejects a whitespace-only title", async () => {
    renderDialog();

    fireEvent.input(screen.getByLabelText("标题"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByText("标题不能为空")).toBeTruthy();
    expect(hooks.createTask).not.toHaveBeenCalled();
  });

  it("toggles tags into the payload", async () => {
    vi.mocked(hooks.createTask).mockResolvedValue(taskFixture("new-1"));
    const { onOpenChange } = renderDialog();

    const work = screen.getByRole("button", { name: "工作" });
    const life = screen.getByRole("button", { name: "生活" });
    fireEvent.input(screen.getByLabelText("标题"), { target: { value: "带标签" } });
    fireEvent.click(work);
    fireEvent.click(life);
    expect(work.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(life); // toggle back off
    expect(life.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(hooks.createTask).mock.calls[0]?.[0]?.tagIds).toEqual(["t1"]);
  });

  it("submits the chosen priority", async () => {
    vi.mocked(hooks.createTask).mockResolvedValue(taskFixture("new-1"));
    const { onOpenChange } = renderDialog();

    await selectPriority("高");
    fireEvent.input(screen.getByLabelText("标题"), { target: { value: "高优" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(hooks.createTask).mock.calls[0]?.[0]?.priority).toBe("high");
  });

  it("converts the datetime-local value to a UTC ISO timestamp", async () => {
    vi.mocked(hooks.createTask).mockResolvedValue(taskFixture("new-1"));
    const { onOpenChange } = renderDialog();

    const local = "2026-01-15T09:30";
    fireEvent.input(screen.getByLabelText("标题"), { target: { value: "有截止" } });
    fireEvent.input(screen.getByLabelText("截止时间"), { target: { value: local } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(hooks.createTask).mock.calls[0]?.[0]?.dueAt).toBe(
      new Date(local).toISOString(),
    );
  });

  it("prefills every field in edit mode and submits a patch payload", async () => {
    const existing = taskFixture("task-9", {
      title: "旧标题",
      note: "备注内容",
      priority: "high",
      dueAt: "2026-01-15T01:30:00.000Z",
      tagIds: ["t1"],
    });
    vi.mocked(hooks.updateTask).mockResolvedValue(existing);
    const { onOpenChange } = renderDialog(existing);

    expect(screen.getByText("编辑任务")).toBeTruthy();
    expect((screen.getByLabelText("标题") as HTMLInputElement).value).toBe("旧标题");
    expect((screen.getByLabelText("备注") as HTMLTextAreaElement).value).toBe(
      "备注内容",
    );
    expect(
      (screen.getByLabelText("截止时间") as HTMLInputElement).value,
    ).toBe(isoToLocalInputValue("2026-01-15T01:30:00.000Z"));
    expect(screen.getByRole("button", { name: "工作" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    // The priority trigger shows the current value, not the placeholder.
    expect(screen.getByRole("button", { name: /优先级/ }).textContent).toContain("高");

    fireEvent.input(screen.getByLabelText("标题"), { target: { value: "新标题" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(hooks.updateTask).toHaveBeenCalledWith("task-9", {
      title: "新标题",
      note: "备注内容",
      priority: "high",
      dueAt: "2026-01-15T01:30:00.000Z",
      tagIds: ["t1"],
    });
  });

  it("keeps the dialog open when the backend rejects the write", async () => {
    vi.mocked(hooks.createTask).mockResolvedValue(null);
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("标题"), { target: { value: "会失败" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(hooks.createTask).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

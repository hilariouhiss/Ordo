import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLORS } from "../../../common/colors";
import { TagManagerDialog } from "../components/TagManagerDialog";
import * as hooks from "../hooks";
import * as store from "../store";
import type { Tag, Task } from "../types";

vi.mock("../hooks", () => ({
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
}));

function tagFixture(id: string, name: string, color: string | null = null): Tag {
  return {
    id,
    name,
    color,
    createdAt: "2026-01-10T10:00:00Z",
    updatedAt: "2026-01-10T10:00:00Z",
    deletedAt: null,
  };
}

function taskFixture(id: string, tagIds: string[]): Task {
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
    complexity: null,
    parentTaskId: null,
    tagIds,
    sortOrder: "n",
    createdAt: "2026-01-10T10:00:00Z",
    updatedAt: "2026-01-10T10:00:00Z",
    deletedAt: null,
  };
}

function renderDialog() {
  const onOpenChange = vi.fn();
  render(() => <TagManagerDialog open={true} onOpenChange={onOpenChange} />);
  return { onOpenChange };
}

describe("TagManagerDialog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    // The create form seeds a palette colour and re-seeds one after every
    // successful create (R3), so the draw decides what is pressed next. Pin it:
    // without this, "the picked swatch is dropped" fails whenever the fresh
    // colour happens to repeat the previous one (about 1 run in 10).
    vi.spyOn(Math, "random").mockReturnValue(0);
    store.resetTasksStore();
    store.setAll(
      [taskFixture("task-1", ["t1"]), taskFixture("task-2", [])],
      [tagFixture("t1", "工作"), tagFixture("t2", "生活", "#00aa00")],
    );
  });

  it("lists tags with their colours and usage counts", () => {
    renderDialog();

    expect(screen.getByText("工作")).toBeTruthy();
    expect(screen.getByText("生活")).toBeTruthy();
    expect(screen.getByText("1 个任务")).toBeTruthy();
    expect(screen.getByText("0 个任务")).toBeTruthy();
  });

  it("creates a tag with a name and colour, then clears the form", async () => {
    vi.mocked(hooks.createTag).mockResolvedValue(tagFixture("t3", "紧急", "#3b82f6"));
    renderDialog();

    fireEvent.input(screen.getByLabelText("新建标签"), { target: { value: "紧急" } });
    const blue = screen.getByRole("button", { name: "颜色 #3b82f6" });
    fireEvent.click(blue);
    expect(blue.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() =>
      expect(hooks.createTag).toHaveBeenCalledWith({ name: "紧急", color: "#3b82f6" }),
    );
    await waitFor(() =>
      expect((screen.getByLabelText("新建标签") as HTMLInputElement).value).toBe(""),
    );
    expect(blue.getAttribute("aria-pressed")).toBe("false");
  });

  // R3: 新建标签的色板预置一个随机色，用户不点也带色创建。
  it("creates a tag with the seeded palette colour when none is picked", async () => {
    vi.mocked(hooks.createTag).mockResolvedValue(tagFixture("t3", "随手"));
    renderDialog();

    fireEvent.input(screen.getByLabelText("新建标签"), { target: { value: "随手" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(hooks.createTag).toHaveBeenCalledTimes(1));
    expect(COLORS).toContain(vi.mocked(hooks.createTag).mock.calls[0]?.[0].color);
  });

  it("seeds a fresh colour for the next tag after a successful create", async () => {
    vi.mocked(hooks.createTag).mockResolvedValue(tagFixture("t3", "随手"));
    renderDialog();

    fireEvent.input(screen.getByLabelText("新建标签"), { target: { value: "随手" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));
    await waitFor(() => expect(hooks.createTag).toHaveBeenCalledTimes(1));

    // Exactly one palette swatch stays pressed: the form is never left colourless.
    const pressed = COLORS.filter((color) =>
      screen.getByRole("button", { name: `颜色 ${color}` }).getAttribute("aria-pressed") === "true",
    );
    expect(pressed).toHaveLength(1);
  });

  it("rejects a blank name without calling the backend", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    expect(await screen.findByText("标签名不能为空")).toBeTruthy();
    expect(hooks.createTag).not.toHaveBeenCalled();
  });

  it("keeps the form values for a retry when creation fails", async () => {
    vi.mocked(hooks.createTag).mockResolvedValue(null);
    renderDialog();

    fireEvent.input(screen.getByLabelText("新建标签"), { target: { value: "工作" } });
    fireEvent.click(screen.getByRole("button", { name: "添加" }));

    await waitFor(() => expect(hooks.createTag).toHaveBeenCalledTimes(1));
    expect((screen.getByLabelText("新建标签") as HTMLInputElement).value).toBe("工作");
  });

  it("renames and recolours a tag inline, then closes the editor", async () => {
    vi.mocked(hooks.updateTag).mockResolvedValue(tagFixture("t1", "加班", "#ef4444"));
    renderDialog();

    // Capture the row before editing: entering edit mode swaps the label span
    // for the form. The edit row reuses the create form's palette, so scope.
    const row = within(screen.getByText("工作").closest("li") as HTMLElement);
    fireEvent.click(row.getByRole("button", { name: "编辑标签 工作" }));
    const input = screen.getByRole("textbox", { name: "编辑标签 工作" }) as HTMLInputElement;
    expect(input.value).toBe("工作");
    fireEvent.input(input, { target: { value: "加班" } });
    fireEvent.click(row.getByRole("button", { name: "颜色 #ef4444" }));
    fireEvent.click(row.getByRole("button", { name: "保存" }));

    await waitFor(() =>
      expect(hooks.updateTag).toHaveBeenCalledWith("t1", {
        name: "加班",
        color: "#ef4444",
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole("textbox", { name: "编辑标签 工作" })).toBeNull(),
    );
  });

  it("shows a validation error for an empty rename and keeps editing", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "编辑标签 工作" }));
    fireEvent.input(screen.getByRole("textbox", { name: "编辑标签 工作" }), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("标签名不能为空")).toBeTruthy();
    expect(hooks.updateTag).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox", { name: "编辑标签 工作" })).toBeTruthy();
  });

  it("closes the inline editor without saving on cancel", () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "编辑标签 工作" }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(screen.queryByRole("textbox", { name: "编辑标签 工作" })).toBeNull();
    expect(hooks.updateTag).not.toHaveBeenCalled();
  });

  it("deletes a tag through the confirmation step", async () => {
    vi.mocked(hooks.deleteTag).mockResolvedValue(true);
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "删除标签 生活" }));
    expect(await screen.findByText(/将同时从 0 个任务上移除/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));

    await waitFor(() => expect(hooks.deleteTag).toHaveBeenCalledWith("t2"));
    await waitFor(() =>
      expect(screen.queryByText(/将同时从 0 个任务上移除/)).toBeNull(),
    );
  });

  it("keeps the tag when a pending delete is cancelled", async () => {
    renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "删除标签 生活" }));
    fireEvent.click(await screen.findByRole("button", { name: "取消" }));

    expect(await screen.findByText("生活")).toBeTruthy();
    expect(hooks.deleteTag).not.toHaveBeenCalled();
  });
});

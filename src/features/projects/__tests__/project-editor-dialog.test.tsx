import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { COLORS } from "../../../common/colors";
import { createNamespace } from "../../namespaces/hooks";
import { resetNamespacesStore, setAll as setNamespaces } from "../../namespaces/store";
import type { Namespace } from "../../namespaces/types";
import { ProjectEditorDialog } from "../components/ProjectEditorDialog";
import * as hooks from "../hooks";
import * as store from "../store";
import type { Project } from "../types";

vi.mock("../hooks", () => ({
  createProject: vi.fn(),
  updateProject: vi.fn(),
}));

// R5: 弹窗里的「＋ 新建命名空间…」走命名空间域的创建收口。
vi.mock("../../namespaces/hooks", () => ({
  createNamespace: vi.fn(),
}));

function projectFixture(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: `项目 ${id}`,
    description: null,
    color: null,
    icon: null,
    namespaceId: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-09T10:00:00Z",
    updatedAt: "2026-09-09T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function namespaceFixture(
  id: string,
  name: string,
  status: "active" | "archived" = "active",
): Namespace {
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

function renderDialog(project?: Project) {
  const onOpenChange = vi.fn();
  render(() => (
    <ProjectEditorDialog open={true} onOpenChange={onOpenChange} project={project} />
  ));
  return { onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resetProjectsStore();
  resetNamespacesStore();
});

afterEach(cleanup);

describe("ProjectEditorDialog", () => {
  it("creates a project with trimmed name and defaults", async () => {
    vi.mocked(hooks.createProject).mockResolvedValue(projectFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "  网站改版  " } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(hooks.createProject).toHaveBeenCalledWith({
      name: "网站改版",
      description: null,
      // R3: 未点颜色 → 弹窗预置的随机色随提交一起落库。
      color: expect.any(String),
      icon: null,
      namespaceId: null,
    });
  });

  it("submits a colour from the palette when the user picks one", async () => {
    vi.mocked(hooks.createProject).mockResolvedValue(projectFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "随手" } });
    const swatch = screen.getByRole("button", { name: `颜色 ${COLORS[5]}` });
    fireEvent.click(swatch);
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(hooks.createProject).toHaveBeenCalledWith(
      expect.objectContaining({ color: COLORS[5] }),
    );
  });

  it("shows a clear error and skips the backend for a blank name", async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByText("项目名不能为空")).toBeTruthy();
    expect(hooks.createProject).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("picks a colour and icon into the payload", async () => {
    vi.mocked(hooks.createProject).mockResolvedValue(projectFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "App 重构" } });
    fireEvent.click(screen.getByRole("button", { name: "颜色 #3b82f6" }));
    fireEvent.click(screen.getByRole("button", { name: "图标 rocket" }));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const payload = vi.mocked(hooks.createProject).mock.calls[0]?.[0];
    expect(payload?.color).toBe("#3b82f6");
    expect(payload?.icon).toBe("rocket");
  });

  it("prefills every field in edit mode and submits a patch payload", async () => {
    const existing = projectFixture("p9", {
      name: "旧名",
      description: "说明",
      color: "#ef4444",
      icon: "rocket",
    });
    vi.mocked(hooks.updateProject).mockResolvedValue(existing);
    const { onOpenChange } = renderDialog(existing);

    expect(screen.getByText("编辑项目")).toBeTruthy();
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("旧名");
    expect((screen.getByLabelText("描述") as HTMLTextAreaElement).value).toBe("说明");
    expect(screen.getByRole("button", { name: "颜色 #ef4444" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "图标 rocket" }).getAttribute("aria-pressed")).toBe(
      "true",
    );
    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "新名" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(hooks.updateProject).toHaveBeenCalledWith("p9", {
      name: "新名",
      description: "说明",
      color: "#ef4444",
      icon: "rocket",
      namespaceId: existing.namespaceId,
    });
  });

  it("keeps the dialog open when the backend rejects the write", async () => {
    vi.mocked(hooks.createProject).mockResolvedValue(null);
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "会失败" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(hooks.createProject).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("files a new project into a picked namespace", async () => {
    setNamespaces([namespaceFixture("ns1", "工作"), namespaceFixture("ns2", "学习")]);
    vi.mocked(hooks.createProject).mockResolvedValue(projectFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "网站改版" } });
    // Select.Label names the trigger via aria-labelledby; Kobalte opens on
    // pointerdown (same helper shape as quick-add-window.test.tsx).
    fireEvent.pointerDown(screen.getByRole("button", { name: /命名空间/ }));
    fireEvent.click(await screen.findByRole("option", { name: "学习" }));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(hooks.createProject).mock.calls[0]?.[0]?.namespaceId).toBe("ns2");
  });

  it("files a new project into a namespace created from the same dialog", async () => {
    vi.mocked(createNamespace).mockResolvedValue(namespaceFixture("ns-new", "新组"));
    vi.mocked(hooks.createProject).mockResolvedValue(projectFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "网站改版" } });
    fireEvent.pointerDown(screen.getByRole("button", { name: /命名空间/ }));
    fireEvent.click(await screen.findByRole("option", { name: "＋ 新建命名空间…" }));

    // The name field only exists once that option is picked.
    fireEvent.input(await screen.findByLabelText("命名空间名称"), {
      target: { value: "  新组  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(createNamespace).toHaveBeenCalledWith({ name: "新组" });
    expect(vi.mocked(hooks.createProject).mock.calls[0]?.[0]?.namespaceId).toBe("ns-new");
  });

  it("skips both writes when the new namespace has no name", async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "网站改版" } });
    fireEvent.pointerDown(screen.getByRole("button", { name: /命名空间/ }));
    fireEvent.click(await screen.findByRole("option", { name: "＋ 新建命名空间…" }));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByText("命名空间名不能为空")).toBeTruthy();
    expect(createNamespace).not.toHaveBeenCalled();
    expect(hooks.createProject).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("stops at a failed namespace write instead of creating a half-filed project", async () => {
    vi.mocked(createNamespace).mockResolvedValue(null);
    vi.mocked(hooks.createProject).mockResolvedValue(projectFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "网站改版" } });
    fireEvent.pointerDown(screen.getByRole("button", { name: /命名空间/ }));
    fireEvent.click(await screen.findByRole("option", { name: "＋ 新建命名空间…" }));
    fireEvent.input(await screen.findByLabelText("命名空间名称"), { target: { value: "新组" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    // The namespace hook already notified + rolled back. Filing the project
    // under a namespace that does not exist would be worse than stopping here:
    // the dialog stays open, so the retry is one click away.
    await waitFor(() => expect(createNamespace).toHaveBeenCalledTimes(1));
    expect(hooks.createProject).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("submits the project's current namespace untouched", async () => {
    setNamespaces([namespaceFixture("ns1", "工作")]);
    const existing = projectFixture("p9", { namespaceId: "ns1" });
    vi.mocked(hooks.updateProject).mockResolvedValue(existing);
    renderDialog(existing);

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(hooks.updateProject).toHaveBeenCalled());
    expect(vi.mocked(hooks.updateProject).mock.calls[0]?.[1]?.namespaceId).toBe("ns1");
  });

  it("keeps an archived namespace selectable instead of silently unfiling", async () => {
    // The project lives in a namespace that is no longer in the navigation;
    // dropping it from the options would rewrite the field on save.
    setNamespaces([namespaceFixture("ns1", "工作", "archived")]);
    const existing = projectFixture("p9", { namespaceId: "ns1" });
    vi.mocked(hooks.updateProject).mockResolvedValue(existing);
    renderDialog(existing);

    fireEvent.pointerDown(screen.getByRole("button", { name: /命名空间/ }));
    expect(await screen.findByRole("option", { name: "工作（已归档）" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(hooks.updateProject).toHaveBeenCalled());
    expect(vi.mocked(hooks.updateProject).mock.calls[0]?.[1]?.namespaceId).toBe("ns1");
  });

  it("shows the archived namespace instead of falling back to 不归属", async () => {
    // The trigger has to display the id the payload will carry: a list without
    // the archived entry reads 不归属 while the save keeps ns1.
    setNamespaces([namespaceFixture("ns1", "工作", "archived")]);
    renderDialog(projectFixture("p9", { namespaceId: "ns1" }));

    expect(screen.getByRole("button", { name: /命名空间/ }).textContent).toContain(
      "工作（已归档）",
    );
  });

  it("keeps an unresolvable namespace visible instead of refiling the project", async () => {
    // The namespace is gone; a project still filed under its id must not read
    // 不归属 while the payload keeps pointing at it.
    setNamespaces([]);
    const existing = projectFixture("p9", { namespaceId: "ghost" });
    vi.mocked(hooks.updateProject).mockResolvedValue(existing);
    renderDialog(existing);

    expect(screen.getByRole("button", { name: /命名空间/ }).textContent).toContain(
      "未知命名空间",
    );

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(hooks.updateProject).toHaveBeenCalled());
    expect(vi.mocked(hooks.updateProject).mock.calls[0]?.[1]?.namespaceId).toBe("ghost");
  });

  it("preselects the namespace a new project is created from", async () => {
    setNamespaces([namespaceFixture("ns2", "学习")]);
    vi.mocked(hooks.createProject).mockResolvedValue(projectFixture("new-1"));
    const onOpenChange = vi.fn();
    render(() => (
      <ProjectEditorDialog open={true} onOpenChange={onOpenChange} defaultNamespaceId="ns2" />
    ));

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "网站改版" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(hooks.createProject).mock.calls[0]?.[0]?.namespaceId).toBe("ns2");
  });

  it("preselects an archived namespace for a new project instead of dropping it", async () => {
    // Task 8's entry point: the namespace page's empty state presets the
    // namespace it is showing, archived ones included.
    setNamespaces([namespaceFixture("ns2", "学习", "archived")]);
    vi.mocked(hooks.createProject).mockResolvedValue(projectFixture("new-1"));
    const onOpenChange = vi.fn();
    render(() => (
      <ProjectEditorDialog open={true} onOpenChange={onOpenChange} defaultNamespaceId="ns2" />
    ));

    expect(screen.getByRole("button", { name: /命名空间/ }).textContent).toContain(
      "学习（已归档）",
    );

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "网站改版" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(vi.mocked(hooks.createProject).mock.calls[0]?.[0]?.namespaceId).toBe("ns2");
  });
});

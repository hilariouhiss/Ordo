/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import { isoToLocalDateValue } from "../../../common/utils/datetime";
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

function projectFixture(id: string, overrides: Partial<Project> = {}): Project {
  return {
    id,
    name: `项目 ${id}`,
    description: null,
    color: null,
    icon: null,
    namespaceId: null,
    dueAt: null,
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
      color: null,
      icon: null,
      namespaceId: null,
      dueAt: null,
    });
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

  it("converts the date input to the end of that local day", async () => {
    vi.mocked(hooks.createProject).mockResolvedValue(projectFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "有截止" } });
    fireEvent.input(screen.getByLabelText("截止日期"), { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const payload = vi.mocked(hooks.createProject).mock.calls[0]?.[0];
    expect(payload?.dueAt).toBe(new Date("2026-12-31T23:59:59").toISOString());
  });

  it("prefills every field in edit mode and submits a patch payload", async () => {
    const existing = projectFixture("p9", {
      name: "旧名",
      description: "说明",
      color: "#ef4444",
      icon: "rocket",
      dueAt: "2026-12-31T15:59:59.000Z",
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
    expect((screen.getByLabelText("截止日期") as HTMLInputElement).value).toBe(
      isoToLocalDateValue(existing.dueAt),
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
      dueAt: existing.dueAt,
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
});

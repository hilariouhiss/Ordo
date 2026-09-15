/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import { COLORS } from "../../../common/colors";
import { NamespaceEditorDialog } from "../components/NamespaceEditorDialog";
import * as hooks from "../hooks";
import * as store from "../store";
import type { Namespace } from "../types";

vi.mock("../hooks", () => ({
  createNamespace: vi.fn(),
  updateNamespace: vi.fn(),
}));

function namespaceFixture(id: string, overrides: Partial<Namespace> = {}): Namespace {
  return {
    id,
    name: `命名空间 ${id}`,
    description: null,
    color: null,
    icon: null,
    status: "active",
    sortOrder: "n",
    createdAt: "2026-09-15T10:00:00Z",
    updatedAt: "2026-09-15T10:00:00Z",
    deletedAt: null,
    ...overrides,
  };
}

function renderDialog(namespace?: Namespace) {
  const onOpenChange = vi.fn();
  render(() => (
    <NamespaceEditorDialog open={true} onOpenChange={onOpenChange} namespace={namespace} />
  ));
  return { onOpenChange };
}

beforeEach(() => {
  vi.clearAllMocks();
  store.resetNamespacesStore();
});

afterEach(cleanup);

describe("NamespaceEditorDialog", () => {
  it("creates a namespace with a trimmed name", async () => {
    vi.mocked(hooks.createNamespace).mockResolvedValue(namespaceFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "  工作  " } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(hooks.createNamespace).toHaveBeenCalledWith({
      name: "工作",
      description: null,
      // R3: 未点颜色 → 弹窗预置的随机色随提交一起落库。
      color: expect.any(String),
      icon: null,
    });
  });

  it("submits the picked colour, not the seeded one", async () => {
    vi.mocked(hooks.createNamespace).mockResolvedValue(namespaceFixture("new-1"));
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "工作" } });
    fireEvent.click(screen.getByRole("button", { name: `颜色 ${COLORS[5]}` }));
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    const payload = vi.mocked(hooks.createNamespace).mock.calls[0]?.[0];
    expect(payload?.color).toBe(COLORS[5]);
  });

  it("shows a clear error and skips the backend for a blank name", async () => {
    const { onOpenChange } = renderDialog();

    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    expect(await screen.findByText("命名空间名不能为空")).toBeTruthy();
    expect(hooks.createNamespace).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("prefills every field in edit mode and submits a patch payload", async () => {
    const existing = namespaceFixture("n9", {
      name: "旧名",
      description: "说明",
      color: "#6366f1",
      icon: "briefcase",
    });
    vi.mocked(hooks.updateNamespace).mockResolvedValue(existing);
    const { onOpenChange } = renderDialog(existing);

    expect(screen.getByText("编辑命名空间")).toBeTruthy();
    expect((screen.getByLabelText("名称") as HTMLInputElement).value).toBe("旧名");
    expect((screen.getByLabelText("描述") as HTMLTextAreaElement).value).toBe("说明");

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "新名" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(hooks.updateNamespace).toHaveBeenCalledWith("n9", {
      name: "新名",
      description: "说明",
      color: "#6366f1",
      icon: "briefcase",
    });
  });

  it("keeps the dialog open when the backend rejects the write", async () => {
    vi.mocked(hooks.createNamespace).mockResolvedValue(null);
    const { onOpenChange } = renderDialog();

    fireEvent.input(screen.getByLabelText("名称"), { target: { value: "会失败" } });
    fireEvent.click(screen.getByRole("button", { name: "创建" }));

    await waitFor(() => expect(hooks.createNamespace).toHaveBeenCalledTimes(1));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});

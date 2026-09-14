/** @vitest-environment jsdom */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { BlockedConfirmHost } from "../components/BlockedConfirmHost";
import { clearBlockedConfirm, blockedRequest, requestBlockedConfirm } from "../blocked-confirm";
import { forceCompleteTask } from "../hooks";

vi.mock("../hooks", () => ({
  forceCompleteTask: vi.fn().mockResolvedValue(null),
  forceCompleteSubtask: vi.fn().mockResolvedValue(null),
}));

describe("BlockedConfirmHost", () => {
  beforeEach(() => {
    // The mock's call history is shared across the two cases below.
    vi.clearAllMocks();
  });

  // Without this the first case's portalled dialog is still in the body when
  // the second one renders, and every query below matches twice.
  afterEach(cleanup);

  it("列出未完成前置，确认后完成并关闭", async () => {
    requestBlockedConfirm({
      kind: "task",
      id: "a",
      parentId: null,
      title: "写周报",
      blockers: [{ kind: "task", id: "b", title: "收集数据" }],
    });
    render(() => <BlockedConfirmHost />);

    expect(screen.getByText(/写周报/)).toBeTruthy();
    expect(screen.getByText("收集数据")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "仍要完成" }));
    expect(forceCompleteTask).toHaveBeenCalledWith("a");
    // Confirming closes the dialog: the parked request is gone.
    expect(blockedRequest()).toBeNull();
  });

  it("取消只关闭对话框", () => {
    requestBlockedConfirm({
      kind: "task",
      id: "a",
      parentId: null,
      title: "写周报",
      blockers: [],
    });
    render(() => <BlockedConfirmHost />);
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(forceCompleteTask).not.toHaveBeenCalled();
    clearBlockedConfirm();
  });
});

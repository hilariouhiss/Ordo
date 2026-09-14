/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { BlockedConfirmHost } from "../components/BlockedConfirmHost";
import { clearBlockedConfirm, blockedRequest, requestBlockedConfirm } from "../blocked-confirm";
import type { BlockedRequest } from "../blocked-confirm";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A parked request whose action is the test's own stand-in. */
function park(run: () => Promise<unknown>): void {
  const request: BlockedRequest = {
    kind: "task",
    id: "a",
    parentId: null,
    title: "写周报",
    blockers: [{ kind: "task", id: "b", title: "收集数据" }],
    run,
  };
  requestBlockedConfirm(request);
}

describe("BlockedConfirmHost", () => {
  // Without this the first case's portalled dialog is still in the body when
  // the second one renders, and every query below matches twice.
  afterEach(() => {
    cleanup();
    clearBlockedConfirm();
  });

  it("列出未完成前置，确认后执行请求里的动作并关闭", async () => {
    const run = vi.fn().mockResolvedValue({ id: "a" });
    park(run);
    render(() => <BlockedConfirmHost />);

    expect(screen.getByText(/写周报/)).toBeTruthy();
    expect(screen.getByText("收集数据")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "仍要完成" }));
    expect(run).toHaveBeenCalledTimes(1);
    // Success drops the parked request: the dialog closes itself.
    await waitFor(() => expect(blockedRequest()).toBeNull());
  });

  it("确认期间保持对话框打开并禁用按钮，避免重复提交", async () => {
    const pending = deferred<unknown>();
    const run = vi.fn(() => pending.promise);
    park(run);
    render(() => <BlockedConfirmHost />);

    const button = screen.getByRole("button", { name: "仍要完成" }) as HTMLButtonElement;
    fireEvent.click(button);

    await waitFor(() => expect(button.disabled).toBe(true));
    expect(run).toHaveBeenCalledTimes(1);
    // The write is still in flight, so the blocker list must not be gone yet.
    expect(blockedRequest()).not.toBeNull();
    expect(screen.getByText("收集数据")).toBeTruthy();

    pending.resolve({ id: "a" });
    await waitFor(() => expect(blockedRequest()).toBeNull());
  });

  it("写入失败时保留请求与前置清单", async () => {
    const run = vi.fn().mockResolvedValue(null);
    park(run);
    render(() => <BlockedConfirmHost />);

    fireEvent.click(screen.getByRole("button", { name: "仍要完成" }));

    await waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    expect(blockedRequest()).not.toBeNull();
    expect(screen.getByText("收集数据")).toBeTruthy();
    // ...and the button comes back, so the user can retry or cancel.
    await waitFor(() =>
      expect(
        (screen.getByRole("button", { name: "仍要完成" }) as HTMLButtonElement).disabled,
      ).toBe(false),
    );
  });

  it("取消只关闭对话框", () => {
    const run = vi.fn();
    park(run);
    render(() => <BlockedConfirmHost />);

    fireEvent.click(screen.getByRole("button", { name: "取消" }));

    expect(run).not.toHaveBeenCalled();
    expect(blockedRequest()).toBeNull();
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNotifications,
  dismissNotification,
  notifications,
  pushError,
  pushInfo,
} from "../../stores/notifications";
import { Dialog } from "../dialog";
import { Toaster } from "../toaster";

vi.useFakeTimers();

beforeEach(() => {
  clearNotifications();
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
});

describe("Toaster", () => {
  it("renders current notifications with alert semantics for errors", () => {
    pushError("保存失败", "database");
    pushInfo("已到截止时间");

    render(() => <Toaster />);

    expect(screen.getByRole("alert").textContent).toContain("保存失败");
    expect(screen.getByRole("status").textContent).toContain("已到截止时间");
  });

  it("dismisses via the close button", () => {
    pushInfo("一条通知");

    render(() => <Toaster />);
    fireEvent.click(screen.getByRole("button", { name: "关闭通知" }));

    expect(screen.queryByRole("status")).toBeNull();
    expect(notifications()).toEqual([]);
  });

  it("auto-dismisses each toast after six seconds", () => {
    pushInfo("第一条");
    pushInfo("第二条");

    render(() => <Toaster />);
    vi.advanceTimersByTime(5999);
    expect(screen.getAllByRole("status").length).toBe(2);

    vi.advanceTimersByTime(1);
    expect(screen.queryByRole("status")).toBeNull();
    expect(notifications()).toEqual([]);
  });

  it("keeps other toasts when one is removed from the store directly", () => {
    const first = pushInfo("第一条");
    pushInfo("第二条");

    render(() => <Toaster />);
    dismissNotification(first);

    expect(screen.getAllByRole("status").length).toBe(1);
    expect(screen.getByRole("status").textContent).toContain("第二条");
  });

  /*
   * A modal dialog hides everything outside itself from assistive tech, and a
   * dialog is exactly where a failed write reports itself — so a toast stack
   * that gets hidden takes the failure message with it.
   */
  it("stays announceable while a modal dialog is open", async () => {
    // Real timers: this is about the DOM the modal produces, and Kobalte's
    // hide-outside pass is scheduled on the clock the fake timers replaced.
    vi.useRealTimers();
    pushError("保存失败", "database");

    render(() => (
      <>
        {/* Sentinel for "the modal's hide-outside pass has run": it is outside
            the dialog and not a top layer, so it always ends up hidden. */}
        <div data-probe="" />
        <Toaster />
        <Dialog.Root open={true} onOpenChange={() => {}}>
          <Dialog.Portal>
            <Dialog.Content>
              <Dialog.Title>编辑任务</Dialog.Title>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </>
    ));

    await screen.findByRole("dialog");
    // The pass is scheduled rather than synchronous, so wait for the sentinel
    // to prove it ran before asking where the toast ended up.
    await waitFor(() =>
      expect(
        document.querySelector("[data-probe]")?.closest('[aria-hidden="true"]'),
      ).not.toBeNull(),
    );
    const alert = document.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.closest('[aria-hidden="true"]')).toBeNull();
  });
});

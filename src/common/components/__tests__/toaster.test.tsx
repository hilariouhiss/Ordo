import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNotifications,
  dismissNotification,
  notifications,
  pushError,
  pushInfo,
} from "../../stores/notifications";
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
});

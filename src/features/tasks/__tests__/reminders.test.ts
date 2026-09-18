import {
  waitFor,
} from "@solidjs/testing-library";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNotifications,
  notifications,
} from "../../../common/stores/notifications";
import { closeTaskViewer, focusedTaskId } from "../../../common/stores/taskViewer";
import * as taskApi from "../api";
import * as taskStore from "../store";
import {
  formatReminderMessage,
  locatePendingReminder,
  pendingReminder,
  resetReminderIntake,
  subscribeToReminders,
  type ReminderPayload,
} from "../reminders";

const listenMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
}));

vi.mock("../api", () => ({
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

function reminder(overrides: Partial<ReminderPayload> = {}): ReminderPayload {
  return {
    taskId: "t1",
    taskTitle: "提交周报",
    kind: "due",
    // Built from local time so the formatted HH:mm is timezone-independent.
    dueAt: new Date(2026, 8, 11, 12, 30).toISOString(),
    ...overrides,
  };
}

function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
}

/** The event handler the subscription registered, for direct dispatch. */
function reminderHandler(): (event: { payload: ReminderPayload }) => void {
  return listenMock.mock.calls.find(([name]) => name === "reminder:triggered")![1];
}

beforeEach(async () => {
  listenMock.mockReset();
  listenMock.mockImplementation(() => Promise.resolve(() => {}));
  vi.mocked(taskApi.listTasks).mockResolvedValue([]);
  vi.mocked(taskApi.listTags).mockResolvedValue([]);
  taskStore.resetTasksStore();
  clearNotifications();
  closeTaskViewer();
  resetReminderIntake();
  setHidden(false);
});

describe("formatReminderMessage", () => {
  it("phrases every reminder kind with the local due time", () => {
    expect(formatReminderMessage(reminder())).toBe(
      "「提交周报」已到截止时间（12:30）",
    );
    expect(
      formatReminderMessage(reminder({ kind: "advance_10m" })),
    ).toBe("「提交周报」将于 10 分钟后（12:30）到期");
    expect(formatReminderMessage(reminder({ kind: "advance_1h" }))).toBe(
      "「提交周报」将于 1 小时后（12:30）到期",
    );
  });

  it("omits the time for an invalid due timestamp", () => {
    expect(formatReminderMessage(reminder({ dueAt: "not-a-date" }))).toBe(
      "「提交周报」已到截止时间（）",
    );
  });

  it("names the task the reminder belongs to, child or not", () => {
    // A child task's reminder carries its own title: the payload has no
    // second level to stitch on.
    expect(
      formatReminderMessage(
        reminder({ taskTitle: "收集数据", kind: "advance_10m" }),
      ),
    ).toBe("「收集数据」将于 10 分钟后（12:30）到期");
  });
});

describe("subscribeToReminders", () => {
  it("subscribes to reminder events and pushes each as an info notification", () => {
    subscribeToReminders();
    expect(listenMock).toHaveBeenCalledWith(
      "reminder:triggered",
      expect.any(Function),
    );

    reminderHandler()({ payload: reminder() });
    expect(notifications().length).toBe(1);
    expect(notifications()[0].kind).toBe("info");
    expect(notifications()[0].message).toContain("已到截止时间");
  });

  it("survives environments without a Tauri runtime", async () => {
    listenMock.mockRejectedValue(new Error("no __TAURI_INTERNALS__"));

    expect(() => subscribeToReminders()).not.toThrow();
    await Promise.resolve();

    expect(notifications()).toEqual([]);
  });

  it("undoes both subscriptions when disposed", async () => {
    const off = vi.fn();
    listenMock.mockResolvedValue(off);

    const dispose = subscribeToReminders();
    await Promise.resolve();
    dispose();

    expect(off).toHaveBeenCalled();
    // The focus hook goes with it: a disposed subscription must not keep
    // locating reminders from a listener nothing owns.
    setHidden(true);
    reminderHandler()({ payload: reminder() });
    window.dispatchEvent(new Event("focus"));
    expect(focusedTaskId()).toBeNull();
  });
});

describe("click-to-locate (R-02)", () => {
  it("holds a reminder as pending when it fires while hidden", () => {
    subscribeToReminders();
    setHidden(true);
    reminderHandler()({ payload: reminder() });

    expect(pendingReminder()?.taskId).toBe("t1");
    expect(focusedTaskId()).toBeNull();
  });

  it("does not hold reminders that fired while visible", () => {
    subscribeToReminders();
    reminderHandler()({ payload: reminder() });

    expect(pendingReminder()).toBeNull();
    expect(notifications().length).toBe(1);
  });

  it("locates the task in the viewer on the next window focus", async () => {
    subscribeToReminders();
    setHidden(true);
    reminderHandler()({ payload: reminder() });

    // The OS focuses the window when the system notification is clicked.
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(focusedTaskId()).toBe("t1"));
    expect(pendingReminder()).toBeNull();
  });

  it("locates nothing when focusing without a pending reminder", async () => {
    subscribeToReminders();
    await locatePendingReminder();

    expect(focusedTaskId()).toBeNull();
  });

  it("queues a burst of hidden reminders and locates them one focus at a time", async () => {
    subscribeToReminders();
    setHidden(true);
    reminderHandler()({ payload: reminder({ taskId: "first" }) });
    reminderHandler()({ payload: reminder({ taskId: "second" }) });

    // The first click-to-locate wins the focus it arrived with…
    await locatePendingReminder();
    expect(focusedTaskId()).toBe("first");

    // …and the second is still waiting rather than overwritten.
    closeTaskViewer();
    await locatePendingReminder();
    expect(focusedTaskId()).toBe("second");
    expect(pendingReminder()).toBeNull();
  });
});

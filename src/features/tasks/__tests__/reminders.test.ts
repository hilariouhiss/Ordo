/** @vitest-environment jsdom */
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearNotifications,
  notifications,
} from "../../../common/stores/notifications";
import {
  formatReminderMessage,
  subscribeToReminders,
  type ReminderPayload,
} from "../reminders";

const listenMock = vi.fn();

vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listenMock(...args),
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

beforeEach(() => {
  listenMock.mockReset();
  clearNotifications();
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
});

describe("subscribeToReminders", () => {
  it("subscribes to reminder events and pushes each as an info notification", async () => {
    let handler!: (event: { payload: ReminderPayload }) => void;
    listenMock.mockImplementation((_name, onEvent) => {
      handler = onEvent;
      return Promise.resolve(() => {});
    });

    await subscribeToReminders();
    expect(listenMock).toHaveBeenCalledWith(
      "reminder:triggered",
      expect.any(Function),
    );

    handler({ payload: reminder() });
    expect(notifications().length).toBe(1);
    expect(notifications()[0].kind).toBe("info");
    expect(notifications()[0].message).toContain("已到截止时间");
  });

  it("survives environments without a Tauri runtime", async () => {
    listenMock.mockRejectedValue(new Error("no __TAURI_INTERNALS__"));
    await expect(subscribeToReminders()).resolves.toBeUndefined();
    expect(notifications()).toEqual([]);
  });
});

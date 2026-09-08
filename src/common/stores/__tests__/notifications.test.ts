import { afterEach, describe, expect, it } from "vitest";
import {
  clearNotifications,
  dismissNotification,
  notifications,
  pushError,
  pushInfo,
} from "../notifications";

describe("notifications store", () => {
  afterEach(() => {
    clearNotifications();
  });

  it("pushes error and info notifications with increasing ids", () => {
    const errorId = pushError("保存失败", "validation");
    const infoId = pushInfo("已恢复");

    expect(errorId).toBeLessThan(infoId);
    expect(notifications()).toEqual([
      { id: errorId, kind: "error", message: "保存失败", code: "validation" },
      { id: infoId, kind: "info", message: "已恢复" },
    ]);
  });

  it("dismisses a single notification by id", () => {
    const first = pushError("第一条");
    const second = pushError("第二条");

    dismissNotification(first);

    expect(notifications().map((item) => item.id)).toEqual([second]);
  });

  it("clears all notifications", () => {
    pushError("一条");
    pushInfo("另一条");

    clearNotifications();

    expect(notifications()).toEqual([]);
  });
});

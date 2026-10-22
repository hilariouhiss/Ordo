import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { askConfirm, closeDialog, dialogRequest } from "../../lib/dialog";
import type { Task } from "../../model/types";
import { warnExclusiveConflict } from "../planning";
import { task } from "./fixtures";

function exclusive(over: Partial<Task> = {}): Task {
  return task({ id: "x", title: "出差", exclusive: true, ...over });
}

describe("warnExclusiveConflict", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 20, 9, 0, 0));
  });

  afterEach(() => {
    closeDialog(null);
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("explains the blocker and the new start", () => {
    const added = task({ id: "n", title: "新任务" });

    warnExclusiveConflict(added, [exclusive(), added]);

    const notice = dialogRequest.value;
    expect(notice?.kind).toBe("notice");
    if (notice?.kind !== "notice") return;
    expect(notice.title).toBe("独占时间冲突");
    expect(notice.message).toContain("出差");
    expect(notice.message).toContain("10/21");
  });

  it("stays quiet when the new task misses the exclusive days", () => {
    const added = task({ id: "n", startDate: "2026-10-22" });

    warnExclusiveConflict(added, [exclusive(), added]);

    expect(dialogRequest.value).toBeNull();
  });

  it("does not replace a dialog that is already open", async () => {
    const pending = askConfirm("删除任务", "不能撤销。");

    warnExclusiveConflict(task({ id: "n" }), [exclusive(), task({ id: "n" })]);

    expect(dialogRequest.value?.kind).toBe("confirm");
    closeDialog(null);
    await pending;
  });
});

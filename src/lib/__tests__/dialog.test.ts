import { describe, expect, it } from "vite-plus/test";
import {
  askConfirm,
  askDefer,
  askNotice,
  askOverdueDefer,
  askSuspend,
  askTaskDefaultScope,
  askText,
  askWaiting,
  closeDialog,
  dialogRequest,
  runWithNotice,
} from "../dialog";

describe("dialog", () => {
  it("prompts with the current value and resolves with the answer", async () => {
    const pending = askText("修改分类名", "软件");
    expect(dialogRequest.value).toEqual({ kind: "text", title: "修改分类名", value: "软件" });
    closeDialog("硬件");
    await expect(pending).resolves.toBe("硬件");
    expect(dialogRequest.value).toBeNull();
  });

  it("asks for an optional suspend reason and date", async () => {
    const pending = askSuspend("挂起「交底」");
    expect(dialogRequest.value).toEqual({ kind: "suspend", title: "挂起「交底」" });
    closeDialog({ reason: "等甲方", until: "2026-11-02" });
    await expect(pending).resolves.toEqual({ reason: "等甲方", until: "2026-11-02" });
  });

  it("accepts an empty suspend form", async () => {
    const pending = askSuspend("挂起「交底」");
    closeDialog({ reason: "", until: "" });
    await expect(pending).resolves.toEqual({ reason: "", until: "" });
  });

  it("treats closing a suspend dialog as a cancel", async () => {
    const pending = askSuspend("挂起「交底」");
    closeDialog(null);
    await expect(pending).resolves.toBeNull();
  });

  it("asks who a task waits on and when to chase them", async () => {
    const pending = askWaiting("等别人「交底」", {
      personId: "u2",
      followUpDate: "2026-11-15",
    });
    expect(dialogRequest.value).toEqual({
      kind: "waiting",
      title: "等别人「交底」",
      personId: "u2",
      followUpDate: "2026-11-15",
    });
    closeDialog({ personId: null, followUpDate: "" });
    await expect(pending).resolves.toEqual({ personId: null, followUpDate: "" });
  });

  it("asks for the new finish and why it moved", async () => {
    const pending = askDefer("延期「交底」", {
      finish: "2026-11-25",
      min: "2026-11-20",
      oldFinish: "2026-11-18",
    });
    expect(dialogRequest.value).toEqual({
      kind: "defer",
      title: "延期「交底」",
      finish: "2026-11-25",
      min: "2026-11-20",
      oldFinish: "2026-11-18",
    });
    closeDialog({ finish: "2026-11-25", reason: "等甲方" });
    await expect(pending).resolves.toEqual({ finish: "2026-11-25", reason: "等甲方" });
  });

  it("treats closing a defer dialog as a cancel", async () => {
    const pending = askDefer("延期「交底」", {
      finish: "2026-11-25",
      min: "2026-11-20",
      oldFinish: "2026-11-18",
    });
    closeDialog(null);
    await expect(pending).resolves.toBeNull();
  });

  it("treats closing a waiting dialog as a cancel", async () => {
    const pending = askWaiting("等别人「交底」", { personId: null, followUpDate: "" });
    closeDialog(null);
    await expect(pending).resolves.toBeNull();
  });

  it("treats closing a confirm as a cancel", async () => {
    const pending = askConfirm("删除任务", "不能撤销。");
    closeDialog(null);
    await expect(pending).resolves.toBe(false);
  });

  it("shows a notice until it is dismissed", async () => {
    const pending = askNotice("提示", "操作已完成。");
    expect(dialogRequest.value).toEqual({
      kind: "notice",
      title: "提示",
      message: "操作已完成。",
    });
    closeDialog(null);
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves true when the confirm is accepted", async () => {
    const pending = askConfirm("删除任务", "不能撤销。");
    closeDialog("ok");
    await expect(pending).resolves.toBe(true);
  });

  it("turns a rejected action into a notice and returns false", async () => {
    const result = await runWithNotice(async () => {
      throw new Error("boom");
    });

    expect(result).toBe(false);
    expect(dialogRequest.value?.kind).toBe("notice");
    closeDialog(null);
  });

  it("returns true when the action succeeds", async () => {
    await expect(runWithNotice(async () => undefined)).resolves.toBe(true);
    expect(dialogRequest.value).toBeNull();
  });

  it("cancels the pending dialog when a second one arrives", async () => {
    const first = askConfirm("删除任务", "不能撤销。");
    const second = askNotice("提示", "保存失败。");

    const answer = await Promise.race([
      first,
      new Promise((resolve) => setTimeout(() => resolve("still pending"), 50)),
    ]);
    expect(answer).toBe(false);
    expect(dialogRequest.value?.kind).toBe("notice");

    closeDialog(null);
    await expect(second).resolves.toBeUndefined();
  });

  it("asks the task-default scope with three answers", async () => {
    const pending = askTaskDefaultScope("新任务默认", "同时改现有任务？");
    expect(dialogRequest.value?.kind).toBe("taskDefault");
    closeDialog("existing");
    await expect(pending).resolves.toBe("existing");
  });

  it("asks the overdue summary with every task and its default day", async () => {
    const tasks = [
      { id: "a", title: "交底", expectedFinishDate: "2026-11-10" },
      { id: "b", title: "报销", expectedFinishDate: "2026-11-11" },
    ];
    const pending = askOverdueDefer("2 项已逾期", tasks, {
      finish: "2026-11-12",
      min: "2026-11-12",
    });

    expect(dialogRequest.value).toEqual({
      kind: "overdue",
      title: "2 项已逾期",
      tasks,
      finish: "2026-11-12",
      min: "2026-11-12",
    });
    closeDialog(null);
    await expect(pending).resolves.toBeNull();
  });
});

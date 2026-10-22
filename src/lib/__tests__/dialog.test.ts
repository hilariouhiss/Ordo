import { describe, expect, it } from "vite-plus/test";
import { askConfirm, askNotice, askSuspend, askText, closeDialog, dialogRequest } from "../dialog";

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

  it("treats closing a confirm as a cancel", async () => {
    const pending = askConfirm("删除任务", "不能撤销。");
    closeDialog(null);
    await expect(pending).resolves.toBe(false);
  });

  it("shows a notice until it is dismissed", async () => {
    const pending = askNotice("独占时间冲突", "已排到 10/21 开始。");
    expect(dialogRequest.value).toEqual({
      kind: "notice",
      title: "独占时间冲突",
      message: "已排到 10/21 开始。",
    });
    closeDialog(null);
    await expect(pending).resolves.toBeUndefined();
  });

  it("resolves true when the confirm is accepted", async () => {
    const pending = askConfirm("删除任务", "不能撤销。");
    closeDialog("ok");
    await expect(pending).resolves.toBe(true);
  });
});

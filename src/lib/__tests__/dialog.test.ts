import { describe, expect, it } from "vite-plus/test";
import { askConfirm, askText, closeDialog, dialogRequest } from "../dialog";

describe("dialog", () => {
  it("prompts with the current value and resolves with the answer", async () => {
    const pending = askText("修改分类名", "软件");
    expect(dialogRequest.value).toEqual({ kind: "text", title: "修改分类名", value: "软件" });
    closeDialog("硬件");
    await expect(pending).resolves.toBe("硬件");
    expect(dialogRequest.value).toBeNull();
  });

  it("treats closing a confirm as a cancel", async () => {
    const pending = askConfirm("删除任务", "不能撤销。");
    closeDialog(null);
    await expect(pending).resolves.toBe(false);
  });

  it("resolves true when the confirm is accepted", async () => {
    const pending = askConfirm("删除任务", "不能撤销。");
    closeDialog("ok");
    await expect(pending).resolves.toBe(true);
  });
});

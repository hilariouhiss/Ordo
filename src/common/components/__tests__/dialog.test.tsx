import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Dialog } from "../dialog";

describe("Dialog", () => {
  afterEach(cleanup);

  it("opens via trigger and closes via the close button", async () => {
    const [open, setOpen] = createSignal(false);

    render(() => (
      <Dialog.Root open={open()} onOpenChange={setOpen}>
        <Dialog.Trigger>打开</Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay />
          <Dialog.Content>
            <Dialog.Title>编辑任务</Dialog.Title>
            <Dialog.Description>修改任务内容</Dialog.Description>
            <Dialog.CloseButton aria-label="关闭" />
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    ));

    fireEvent.click(screen.getByRole("button", { name: "打开" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("编辑任务")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    await waitFor(() => expect(open()).toBe(false));
  });

  it("closes on Escape", async () => {
    const [open, setOpen] = createSignal(true);

    render(() => (
      <Dialog.Root open={open()} onOpenChange={setOpen}>
        <Dialog.Portal>
          <Dialog.Content>
            <Dialog.Title>确认操作</Dialog.Title>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    ));

    await screen.findByRole("dialog");
    fireEvent.keyDown(document.body, { key: "Escape" });

    await waitFor(() => expect(open()).toBe(false));
  });

  /*
   * Every dialog in the app is opened from a menu item, a row button or a file
   * picker's result — never from a `Dialog.Trigger` — so Kobalte has no trigger
   * to hand focus back to and the keyboard user used to land on <body>.
   */
  it("returns focus to the control that opened it", async () => {
    const [open, setOpen] = createSignal(false);

    render(() => (
      <>
        <button type="button" onClick={() => setOpen(true)}>
          打开设置
        </button>
        <Dialog.Root open={open()} onOpenChange={setOpen}>
          <Dialog.Portal>
            <Dialog.Content>
              <Dialog.Title>确认操作</Dialog.Title>
              <Dialog.Description>这会覆盖当前全部数据</Dialog.Description>
              <Dialog.CloseButton aria-label="关闭" />
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      </>
    ));

    const opener = screen.getByRole("button", { name: "打开设置" });
    opener.focus();
    fireEvent.click(opener);
    await screen.findByRole("dialog");
    // jsdom does not run Kobalte's autofocus, so the browser's "focus moved
    // into the dialog" state is set up by hand — without it this test would
    // pass on the old code for the wrong reason (focus never left the opener).
    (screen.getByRole("button", { name: "关闭" }) as HTMLElement).focus();
    expect(document.activeElement).not.toBe(opener);

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    await waitFor(() => expect(open()).toBe(false));
    // Kobalte dispatches its close-auto-focus after the panel is gone, so the
    // restore lands a tick later.
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});

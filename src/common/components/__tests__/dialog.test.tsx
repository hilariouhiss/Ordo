/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import "./setup";
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
});

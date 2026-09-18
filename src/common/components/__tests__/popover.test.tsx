import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Popover } from "../popover";

describe("Popover", () => {
  afterEach(cleanup);

  it("opens via trigger and closes via the close button", async () => {
    const [open, setOpen] = createSignal(false);

    render(() => (
      <Popover.Root open={open()} onOpenChange={setOpen}>
        <Popover.Trigger>详情</Popover.Trigger>
        <Popover.Portal>
          <Popover.Content>
            <Popover.Title>更多信息</Popover.Title>
            <Popover.Description>这里展示更多内容。</Popover.Description>
            <Popover.CloseButton aria-label="关闭" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    ));

    fireEvent.click(screen.getByRole("button", { name: "详情" }));

    expect(await screen.findByText("更多信息")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "关闭" }));

    await waitFor(() => expect(open()).toBe(false));
  });
});

import { cleanup, fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DropdownMenu } from "../dropdown-menu";

describe("DropdownMenu", () => {
  afterEach(cleanup);

  it("opens, selects an item and closes", async () => {
    const [open, setOpen] = createSignal(false);
    const onSelect = vi.fn();

    render(() => (
      <DropdownMenu.Root open={open()} onOpenChange={setOpen}>
        <DropdownMenu.Trigger>菜单</DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content>
            <DropdownMenu.Item onSelect={onSelect}>重命名</DropdownMenu.Item>
            <DropdownMenu.Separator />
            <DropdownMenu.Item disabled>删除</DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    ));

    fireEvent.pointerDown(screen.getByRole("button", { name: "菜单" }));

    const item = await screen.findByRole("menuitem", { name: "重命名" });
    fireEvent.pointerUp(item);

    expect(onSelect).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(open()).toBe(false));
  });
});

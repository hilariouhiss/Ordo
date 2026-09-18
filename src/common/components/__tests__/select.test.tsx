import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Select } from "../select";

const OPTIONS = ["high", "medium", "low", "none"] as const;

describe("Select", () => {
  afterEach(cleanup);

  it("opens the listbox and selects an option", async () => {
    const [value, setValue] = createSignal<string | null>(null);

    render(() => (
      <Select.Root
        options={[...OPTIONS]}
        optionValue={(option) => option}
        optionTextValue={(option) => option}
        itemToString={(option) => option}
        value={value()}
        onChange={setValue}
      >
        <Select.Trigger>
          <Select.Value />
          <Select.Icon />
        </Select.Trigger>
        <Select.Content>
          <Select.Listbox />
        </Select.Content>
      </Select.Root>
    ));

    fireEvent.pointerDown(screen.getByRole("button"));

    const option = await screen.findByRole("option", { name: "medium" });
    fireEvent.click(option);

    expect(value()).toBe("medium");
  });

  it("shows the placeholder when empty", () => {
    render(() => (
      <Select.Root
        options={[...OPTIONS]}
        optionValue={(option) => option}
        itemToString={(option) => option}
        placeholder="选择优先级"
      >
        <Select.Trigger>
          <Select.Value />
          <Select.Icon />
        </Select.Trigger>
        <Select.Content>
          <Select.Listbox />
        </Select.Content>
      </Select.Root>
    ));

    expect(screen.getByText("选择优先级")).toBeTruthy();
  });
});

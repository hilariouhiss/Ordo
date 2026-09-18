import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { Checkbox } from "../checkbox";

describe("Checkbox", () => {
  afterEach(cleanup);

  it("toggles the controlled checked state", () => {
    const [checked, setChecked] = createSignal(false);

    render(() => (
      <Checkbox.Root checked={checked()} onChange={setChecked}>
        <Checkbox.Input />
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <Checkbox.Label>启用提醒</Checkbox.Label>
      </Checkbox.Root>
    ));

    fireEvent.click(screen.getByRole("checkbox"));

    expect(checked()).toBe(true);
  });

  it("is disabled when requested", () => {
    render(() => (
      <Checkbox.Root disabled>
        <Checkbox.Input />
        <Checkbox.Control>
          <Checkbox.Indicator />
        </Checkbox.Control>
        <Checkbox.Label>不可用</Checkbox.Label>
      </Checkbox.Root>
    ));

    expect((screen.getByRole("checkbox") as HTMLInputElement).disabled).toBe(true);
  });
});

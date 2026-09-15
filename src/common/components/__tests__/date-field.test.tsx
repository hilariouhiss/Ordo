/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { createSignal } from "solid-js";
import { DateField } from "../date-field";
import { TextField } from "../text-field";
import "./setup";

afterEach(cleanup);

describe("DateField", () => {
  it("shows the Chinese placeholder for an empty date field", () => {
    render(() => (
      <DateField type="date" value="">
        <input type="date" aria-label="截止日期" />
      </DateField>
    ));

    expect(screen.getByText("年/月/日")).toBeTruthy();
  });

  it("shows 时:分 for an empty datetime field and hides both once filled", () => {
    const [value, setValue] = createSignal("");
    render(() => (
      <DateField type="datetime-local" value={value()}>
        <input type="datetime-local" aria-label="截止时间" />
      </DateField>
    ));

    expect(screen.getByText("年/月/日 时:分")).toBeTruthy();

    setValue("2026-12-31T23:59");

    // With a value the native segments are the only text: the placeholder is
    // gone, and `data-empty` no longer matches so the CSS leaves them visible.
    expect(screen.queryByText("年/月/日 时:分")).toBeNull();
    expect(document.querySelector(".date-field")?.hasAttribute("data-empty")).toBe(false);
  });

  it("carries the Kobalte field wiring through to the wrapped input", () => {
    render(() => (
      <TextField.Root value="" onChange={() => {}}>
        <TextField.Label>截止时间</TextField.Label>
        <DateField type="datetime-local" value="">
          <TextField.Input type="datetime-local" />
        </DateField>
      </TextField.Root>
    ));

    // The label still names the input, not the wrapper's placeholder.
    expect(screen.getByLabelText("截止时间").getAttribute("type")).toBe("datetime-local");
  });
});

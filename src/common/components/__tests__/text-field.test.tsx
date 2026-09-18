import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TextField } from "../text-field";

describe("TextField", () => {
  afterEach(cleanup);

  it("forwards input changes and shows validation errors", () => {
    const [value, setValue] = createSignal("");

    render(() => (
      <TextField.Root
        value={value()}
        onChange={setValue}
        validationState={value().trim() ? "valid" : "invalid"}
      >
        <TextField.Label>标题</TextField.Label>
        <TextField.Input placeholder="输入标题" />
        <TextField.ErrorMessage>标题不能为空</TextField.ErrorMessage>
      </TextField.Root>
    ));

    expect(screen.getByText("标题不能为空")).toBeTruthy();

    fireEvent.input(screen.getByRole("textbox"), { target: { value: "新任务" } });

    expect(value()).toBe("新任务");
    expect(screen.queryByText("标题不能为空")).toBeNull();
  });

  it("renders a textarea when using TextField.TextArea", () => {
    render(() => (
      <TextField.Root>
        <TextField.Label>备注</TextField.Label>
        <TextField.TextArea placeholder="补充说明" />
      </TextField.Root>
    ));

    expect(screen.getByRole("textbox", { name: "备注" }).tagName).toBe("TEXTAREA");
  });

  it("passes through plain string changes via onChange", () => {
    const onChange = vi.fn();
    render(() => (
      <TextField.Root onChange={onChange}>
        <TextField.Input aria-label="搜索" />
      </TextField.Root>
    ));

    fireEvent.input(screen.getByLabelText("搜索"), { target: { value: "abc" } });

    expect(onChange).toHaveBeenCalledWith("abc");
  });
});

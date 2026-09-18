import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Button } from "../button";

describe("Button", () => {
  afterEach(cleanup);

  it("renders children and handles clicks", () => {
    const onClick = vi.fn();
    render(() => <Button onClick={onClick}>保存</Button>);

    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("can be disabled", () => {
    render(() => <Button disabled>保存</Button>);

    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
  });
});

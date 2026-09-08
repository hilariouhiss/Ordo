/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import "./setup";
import { Tooltip } from "../tooltip";

describe("Tooltip", () => {
  afterEach(cleanup);

  it("shows the content when the trigger receives focus", async () => {
    render(() => (
      <Tooltip.Root openDelay={0} closeDelay={0}>
        <Tooltip.Trigger as="button">保存</Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content>保存当前更改</Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    ));

    fireEvent.focus(screen.getByRole("button", { name: "保存" }));

    expect(await screen.findByText("保存当前更改")).toBeTruthy();
  });
});

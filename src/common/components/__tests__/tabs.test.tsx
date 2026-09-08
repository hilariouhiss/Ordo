/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import "./setup";
import { Tabs } from "../tabs";

describe("Tabs", () => {
  afterEach(cleanup);

  it("switches the active panel when a trigger is clicked", () => {
    const [tab, setTab] = createSignal("list");

    render(() => (
      <Tabs.Root value={tab()} onChange={setTab}>
        <Tabs.List>
          <Tabs.Trigger value="list">列表</Tabs.Trigger>
          <Tabs.Trigger value="board">看板</Tabs.Trigger>
          <Tabs.Indicator />
        </Tabs.List>
        <Tabs.Content value="list">列表内容</Tabs.Content>
        <Tabs.Content value="board">看板内容</Tabs.Content>
      </Tabs.Root>
    ));

    fireEvent.click(screen.getByRole("tab", { name: "看板" }));

    expect(tab()).toBe("board");
    expect(screen.getByText("看板内容")).toBeTruthy();
    expect(screen.queryByText("列表内容")).toBeNull();
  });
});

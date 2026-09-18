import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import { ProjectProgress } from "../components/ProjectProgress";

function bar(): string {
  return screen.getByRole("progressbar").getAttribute("aria-valuenow") ?? "";
}

afterEach(cleanup);

describe("ProjectProgress", () => {
  it("summarises an empty project without dividing by zero", () => {
    render(() => <ProjectProgress total={0} completed={0} />);

    expect(bar()).toBe("0");
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe("完成率 0%");
    expect(screen.getByText("0 / 0 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 0 项")).toBeTruthy();
  });

  it("renders the tallies the caller hands in", () => {
    render(() => <ProjectProgress total={4} completed={3} />);

    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("3 / 4 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 1 项")).toBeTruthy();
    expect(bar()).toBe("75");
  });

  it("rounds the rate to whole percent", () => {
    render(() => <ProjectProgress total={3} completed={1} />);

    expect(screen.getByText("33%")).toBeTruthy();
  });

  // R2: projects have no deadline, so nothing here counts down any more.
  it("shows no countdown at all", () => {
    render(() => <ProjectProgress total={1} completed={0} />);

    expect(screen.getByText("剩余 1 项")).toBeTruthy();
    expect(screen.queryByText(/截止|逾期/)).toBeNull();
  });

  // 两个数字是调用方的口径（项目页数自己范围的行，命名空间页传服务端聚合），
  // 面板只跟着 props 走 —— 数字换了，这一帧就得换。
  it("moves the bar when the caller's numbers change", () => {
    const [total, setTotal] = createSignal(2);
    const [completed, setCompleted] = createSignal(0);
    render(() => <ProjectProgress total={total()} completed={completed()} />);

    expect(screen.getByText("0 / 2 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 2 项")).toBeTruthy();

    setCompleted(1);

    expect(screen.getByText("1 / 2 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 1 项")).toBeTruthy();
    expect(bar()).toBe("50");

    setTotal(4);

    expect(screen.getByText("1 / 4 已完成")).toBeTruthy();
    expect(bar()).toBe("25");
  });
});

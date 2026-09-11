/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { afterEach, describe, expect, it } from "vitest";
import "../../../common/components/__tests__/setup";
import type { Task } from "../../tasks/types";
import { ProjectProgress } from "../components/ProjectProgress";

function task(id: string, completed: boolean): Task {
  return {
    id,
    projectId: "proj-1",
    title: `任务 ${id}`,
    note: null,
    priority: "none",
    columnId: null,
    dueAt: null,
    completedAt: completed ? "2026-09-09T10:00:00Z" : null,
    repeatRule: null,
    tagIds: [],
    sortOrder: id,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    deletedAt: null,
  };
}

/** Local due instant `days` from today, at the end of that local day. */
function dueIn(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(23, 59, 59, 0);
  return date.toISOString();
}

function bar(): string {
  return screen.getByRole("progressbar").getAttribute("aria-valuenow") ?? "";
}

afterEach(cleanup);

describe("ProjectProgress", () => {
  it("summarises an empty project without dividing by zero", () => {
    render(() => <ProjectProgress tasks={[]} dueAt={null} />);

    expect(bar()).toBe("0");
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe("完成率 0%");
    expect(screen.getByText("0 / 0 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 0 项")).toBeTruthy();
  });

  it("counts completions and the work left", () => {
    render(() => (
      <ProjectProgress
        tasks={[task("t1", true), task("t2", true), task("t3", true), task("t4", false)]}
        dueAt={null}
      />
    ));

    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("3 / 4 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 1 项")).toBeTruthy();
    expect(bar()).toBe("75");
  });

  it("rounds the rate to whole percent", () => {
    render(() => (
      <ProjectProgress tasks={[task("t1", true), task("t2", false), task("t3", false)]} dueAt={null} />
    ));

    expect(screen.getByText("33%")).toBeTruthy();
  });

  it("counts down to a future due date", () => {
    render(() => <ProjectProgress tasks={[]} dueAt={dueIn(10)} />);

    const countdown = screen.getByText(/距截止还有/);
    // Calendar days, not elapsed hours: the number must not shift with the
    // hour the panel happens to be read at.
    expect(countdown.textContent).toBe("距截止还有 10 天");
    expect(countdown.className).not.toContain("text-danger");
  });

  it("reads a due date later today as due today", () => {
    render(() => <ProjectProgress tasks={[]} dueAt={dueIn(0)} />);

    expect(screen.getByText("今天截止")).toBeTruthy();
  });

  it("flags an overdue due date", () => {
    render(() => <ProjectProgress tasks={[]} dueAt={dueIn(-3)} />);

    const countdown = screen.getByText(/已逾期/);
    expect(countdown.textContent).toBe("已逾期 3 天");
    expect(countdown.className).toContain("text-danger");
  });

  it("moves the bar as tasks are completed", () => {
    const [tasks, setTasks] = createSignal([task("t1", false), task("t2", false)]);
    render(() => <ProjectProgress tasks={tasks()} dueAt={null} />);

    expect(screen.getByText("0 / 2 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 2 项")).toBeTruthy();

    setTasks([task("t1", true), task("t2", false)]);

    expect(screen.getByText("1 / 2 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 1 项")).toBeTruthy();
    expect(bar()).toBe("50");
  });
});

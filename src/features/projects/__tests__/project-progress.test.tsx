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
    complexity: null,
    parentTaskId: null,
    tagIds: [],
    sortOrder: id,
    createdAt: "2026-09-01T10:00:00Z",
    updatedAt: "2026-09-01T10:00:00Z",
    deletedAt: null,
  };
}

function bar(): string {
  return screen.getByRole("progressbar").getAttribute("aria-valuenow") ?? "";
}

afterEach(cleanup);

describe("ProjectProgress", () => {
  it("summarises an empty project without dividing by zero", () => {
    render(() => <ProjectProgress tasks={[]} />);

    expect(bar()).toBe("0");
    expect(screen.getByRole("progressbar").getAttribute("aria-label")).toBe("完成率 0%");
    expect(screen.getByText("0 / 0 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 0 项")).toBeTruthy();
  });

  it("counts completions and the work left", () => {
    render(() => (
      <ProjectProgress
        tasks={[task("t1", true), task("t2", true), task("t3", true), task("t4", false)]}
      />
    ));

    expect(screen.getByText("75%")).toBeTruthy();
    expect(screen.getByText("3 / 4 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 1 项")).toBeTruthy();
    expect(bar()).toBe("75");
  });

  it("rounds the rate to whole percent", () => {
    render(() => (
      <ProjectProgress tasks={[task("t1", true), task("t2", false), task("t3", false)]} />
    ));

    expect(screen.getByText("33%")).toBeTruthy();
  });

  // R2: projects have no deadline, so nothing here counts down any more.
  it("shows no countdown at all", () => {
    render(() => <ProjectProgress tasks={[task("t1", false)]} />);

    expect(screen.getByText("剩余 1 项")).toBeTruthy();
    expect(screen.queryByText(/截止|逾期/)).toBeNull();
  });

  it("moves the bar as tasks are completed", () => {
    const [tasks, setTasks] = createSignal([task("t1", false), task("t2", false)]);
    render(() => <ProjectProgress tasks={tasks()} />);

    expect(screen.getByText("0 / 2 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 2 项")).toBeTruthy();

    setTasks([task("t1", true), task("t2", false)]);

    expect(screen.getByText("1 / 2 已完成")).toBeTruthy();
    expect(screen.getByText("剩余 1 项")).toBeTruthy();
    expect(bar()).toBe("50");
  });
});

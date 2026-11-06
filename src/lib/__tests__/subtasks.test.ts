import { describe, expect, it } from "vite-plus/test";
import { task } from "../../viewmodels/__tests__/fixtures";
import { currentSubtask, subtasksDone } from "../subtasks";

function child(id: string, status: "todo" | "doing" | "done") {
  return task({ id, title: `子任务 ${id}`, status, parentId: "t1" });
}

describe("currentSubtask", () => {
  it("is null without subtasks", () => {
    expect(currentSubtask([])).toBeNull();
  });

  it("is the first one still open", () => {
    const children = [child("a", "done"), child("b", "doing"), child("c", "todo")];
    expect(currentSubtask(children)?.id).toBe("b");
  });

  it("is null once every subtask is done", () => {
    expect(currentSubtask([child("a", "done"), child("b", "done")])).toBeNull();
  });
});

describe("subtasksDone", () => {
  it("counts the finished ones", () => {
    expect(subtasksDone([child("a", "done"), child("b", "todo")])).toBe(1);
  });

  it("is zero without subtasks", () => {
    expect(subtasksDone([])).toBe(0);
  });
});

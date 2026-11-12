import { describe, expect, it } from "vite-plus/test";
import { task } from "../../viewmodels/__tests__/fixtures";
import {
  currentSubtask,
  orderSubtasks,
  subtaskDropSlot,
  subtaskMoveTarget,
  subtasksDone,
} from "../subtasks";

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

describe("orderSubtasks", () => {
  it("puts the draft order first and appends children it does not know", () => {
    const children = [child("a", "todo"), child("b", "todo"), child("c", "todo")];
    expect(orderSubtasks(children, ["c", "a"]).map((one) => one.id)).toEqual(["c", "a", "b"]);
  });

  it("keeps the stored order without a draft", () => {
    const children = [child("a", "done"), child("b", "todo")];
    expect(orderSubtasks(children, []).map((one) => one.id)).toEqual(["a", "b"]);
  });
});

describe("subtaskDropSlot", () => {
  it("inserts before the row while the pointer is in its top half", () => {
    expect(subtaskDropSlot(1, 10, 0, 34)).toBe(1);
    expect(subtaskDropSlot(1, 17, 0, 34)).toBe(1);
  });

  it("inserts after the row once the pointer crosses the middle", () => {
    expect(subtaskDropSlot(1, 18, 0, 34)).toBe(2);
    expect(subtaskDropSlot(1, 34, 0, 34)).toBe(2);
  });
});

describe("subtaskMoveTarget", () => {
  const children = [child("a", "todo"), child("b", "todo"), child("c", "todo")];

  it("moves a middle task before its previous sibling", () => {
    expect(subtaskMoveTarget(children, 1, -1)).toEqual({ beforeId: "a" });
  });

  it("moves a task down past the next sibling", () => {
    expect(subtaskMoveTarget(children, 0, 1)).toEqual({ beforeId: "c" });
  });

  it("moves the second-to-last task to the end", () => {
    expect(subtaskMoveTarget(children, 1, 1)).toEqual({ beforeId: null });
  });

  it("does nothing at the ends", () => {
    expect(subtaskMoveTarget(children, 0, -1)).toBeNull();
    expect(subtaskMoveTarget(children, 2, 1)).toBeNull();
    expect(subtaskMoveTarget([], 0, 1)).toBeNull();
  });
});

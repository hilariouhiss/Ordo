import type { Settings, Step, Task } from "../../model/types";

export const defaultSettings: Settings = {
  aiEnabled: false,
  aiBaseUrl: "https://api.deepseek.com",
  aiModel: "deepseek-flash",
  aiHasKey: false,
  shortcut: "Ctrl+Alt+O",
  autostart: true,
  weekStart: 1,
  backupKeepDays: 30,
};

export function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    title: "示例",
    projectId: null,
    categoryId: null,
    ownerId: null,
    startDate: null,
    dueDate: null,
    status: "todo",
    inWeek: true,
    carryCount: 0,
    suspendedUntil: null,
    note: null,
    archivedAt: null,
    canceledAt: null,
    createdAt: "2026-10-20T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
    steps: [],
    tags: [],
    delays: [],
    ...over,
  };
}

export function step(over: Partial<Step> = {}): Step {
  return {
    id: "s1",
    taskId: "t1",
    title: "一步",
    sortOrder: 0,
    done: false,
    dueDate: null,
    ...over,
  };
}

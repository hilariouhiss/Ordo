import type { Settings, Step, Task } from "../../model/types";

export const defaultSettings: Settings = {
  theme: "system",
  language: "zh",
  aiEnabled: false,
  aiBaseUrl: "https://api.deepseek.com",
  aiModel: "deepseek-flash",
  shortcut: "Ctrl+Alt+O",
  autostart: true,
  backupKeepDays: 30,
  backupError: null,
  deskEnabled: false,
  deskControls: true,
  deskPin: "top",
  deskX: null,
  deskY: null,
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
    suspended: false,
    suspendedAt: null,
    suspendReason: null,
    note: null,
    archivedAt: null,
    canceledAt: null,
    createdAt: "2026-10-20T00:00:00Z",
    updatedAt: "2026-10-20T00:00:00Z",
    sortOrder: 0,
    effortDays: 1,
    priority: "normal",
    exclusive: false,
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

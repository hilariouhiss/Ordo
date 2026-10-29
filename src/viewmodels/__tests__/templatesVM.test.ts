import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  listRules: vi.fn(),
  listTemplates: vi.fn(),
  saveRule: vi.fn(),
  setRuleEnabled: vi.fn(),
  deleteRule: vi.fn(),
  saveTemplate: vi.fn(),
  deleteTemplate: vi.fn(),
  createTaskFromTemplate: vi.fn(),
}));
vi.mock("../weekVM", () => ({ weekVM: { load: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("../taskSheetVM", () => ({
  taskSheetVM: { open: vi.fn().mockResolvedValue(undefined) },
}));

import * as ipc from "../../model/ipc";
import type { TaskRule, TaskTemplate } from "../../model/types";
import { createTemplatesVM } from "../templatesVM";
import { task } from "./fixtures";

function rule(over: Partial<TaskRule> = {}): TaskRule {
  return {
    id: "r1",
    title: "报销",
    weekdays: [4],
    at: "09:00",
    projectId: null,
    categoryId: null,
    ownerId: null,
    priority: "normal",
    effortMinutes: 480,
    exclusive: false,
    enabled: true,
    ...over,
  };
}

function template(over: Partial<TaskTemplate> = {}): TaskTemplate {
  return {
    id: "p1",
    name: "发布流程",
    projectId: null,
    categoryId: null,
    ownerId: null,
    priority: "normal",
    effortMinutes: 960,
    exclusive: false,
    note: null,
    steps: ["打标签", "发版"],
    ...over,
  };
}

beforeEach(() => {
  vi.mocked(ipc.listRules).mockResolvedValue([rule()]);
  vi.mocked(ipc.listTemplates).mockResolvedValue([template()]);
  vi.mocked(ipc.saveRule).mockResolvedValue(rule());
});

describe("templatesVM", () => {
  it("loads rules and templates", async () => {
    const vm = createTemplatesVM();
    await vm.load();

    expect(vm.state.rules.map((r) => r.id)).toEqual(["r1"]);
    expect(vm.state.templates.map((t) => t.id)).toEqual(["p1"]);
    expect(vm.state.loading).toBe(false);
  });

  it("reloads after saving a rule", async () => {
    const vm = createTemplatesVM();
    await vm.saveRule({
      title: "报销",
      weekdays: [4],
      at: "09:00",
      projectId: null,
      categoryId: null,
      ownerId: null,
      priority: "normal",
      effortMinutes: 480,
      exclusive: false,
    });

    expect(vi.mocked(ipc.saveRule)).toHaveBeenCalledOnce();
    expect(vi.mocked(ipc.listRules)).toHaveBeenCalled();
  });

  it("flips a rule's switch", async () => {
    vi.mocked(ipc.setRuleEnabled).mockResolvedValue(rule({ enabled: false }));
    const vm = createTemplatesVM();
    await vm.toggleRule(rule());

    expect(vi.mocked(ipc.setRuleEnabled)).toHaveBeenCalledWith("r1", false);
  });

  it("uses a template and opens the new task", async () => {
    vi.mocked(ipc.createTaskFromTemplate).mockResolvedValue(task({ id: "t9" }));
    const vm = createTemplatesVM();
    await vm.useTemplate(template());

    expect(vi.mocked(ipc.createTaskFromTemplate)).toHaveBeenCalledWith("p1");
    const { taskSheetVM } = await import("../taskSheetVM");
    expect(vi.mocked(taskSheetVM.open)).toHaveBeenCalledWith("t9");
  });

  it("stops loading when a list request fails", async () => {
    vi.mocked(ipc.listTemplates).mockRejectedValue("boom");
    const vm = createTemplatesVM();

    await expect(vm.load()).rejects.toBe("boom");
    expect(vm.state.loading).toBe(false);
  });
});

import { reactive } from "vue";
import * as ipc from "../model/ipc";
import type { RuleInput, TaskRule, TaskTemplate, TemplateInput } from "../model/types";
import { taskSheetVM } from "./taskSheetVM";
import { weekVM } from "./weekVM";

export function createTemplatesVM() {
  const state = reactive({
    rules: [] as TaskRule[],
    templates: [] as TaskTemplate[],
    loading: false,
  });

  async function load(): Promise<void> {
    state.loading = true;
    try {
      const [rules, templates] = await Promise.all([ipc.listRules(), ipc.listTemplates()]);
      state.rules = rules;
      state.templates = templates;
    } finally {
      state.loading = false;
    }
  }

  /** A new rule may already owe today's occurrence, so the week reloads too. */
  async function saveRule(rule: RuleInput): Promise<void> {
    await ipc.saveRule(rule);
    await load();
    await weekVM.load();
  }

  async function toggleRule(rule: TaskRule): Promise<void> {
    await ipc.setRuleEnabled(rule.id, !rule.enabled);
    await load();
  }

  async function removeRule(id: string): Promise<void> {
    await ipc.deleteRule(id);
    await load();
  }

  async function saveTemplate(template: TemplateInput): Promise<void> {
    await ipc.saveTemplate(template);
    await load();
  }

  async function removeTemplate(id: string): Promise<void> {
    await ipc.deleteTemplate(id);
    await load();
  }

  /** Creates the task from the template, then opens it so dates can be adjusted. */
  async function useTemplate(template: TaskTemplate): Promise<void> {
    const task = await ipc.createTaskFromTemplate(template.id);
    await weekVM.load();
    await taskSheetVM.open(task.id);
  }

  return {
    state,
    load,
    saveRule,
    toggleRule,
    removeRule,
    saveTemplate,
    removeTemplate,
    useTemplate,
  };
}

export const templatesVM = createTemplatesVM();

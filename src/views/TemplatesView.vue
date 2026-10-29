<script setup lang="ts">
import { AnimatePresence, motion } from "motion-v";
import { onMounted, ref } from "vue";
import { askConfirm, runWithNotice } from "../lib/dialog";
import { t } from "../lib/i18n";
import { formatEffort } from "../lib/effort";
import { listItemMotion } from "../lib/motion";
import { ruleSummary } from "../lib/rules";
import type { TaskRule, TaskTemplate } from "../model/types";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { templatesVM as vm } from "../viewmodels/templatesVM";
import RuleSheet from "./overlays/RuleSheet.vue";
import TaskSheet from "./overlays/TaskSheet.vue";
import TemplateSheet from "./overlays/TemplateSheet.vue";

const ruleSheet = ref<TaskRule | "new" | null>(null);
const templateSheet = ref<TaskTemplate | "new" | null>(null);

onMounted(() => void vm.load());

async function useTemplate(template: TaskTemplate): Promise<void> {
  await runWithNotice(() => vm.useTemplate(template));
}

async function toggleRule(rule: TaskRule): Promise<void> {
  await runWithNotice(() => vm.toggleRule(rule));
}

async function removeRule(rule: TaskRule): Promise<void> {
  const ok = await askConfirm(
    t("templates.deleteRuleTitle"),
    t("templates.deleteRuleMessage", { title: rule.title }),
  );
  if (ok) await runWithNotice(() => vm.removeRule(rule.id));
}

async function removeTemplate(template: TaskTemplate): Promise<void> {
  const ok = await askConfirm(
    t("templates.deleteTemplateTitle"),
    t("templates.deleteTemplateMessage", { title: template.name }),
  );
  if (ok) await runWithNotice(() => vm.removeTemplate(template.id));
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">{{ t("templates.title") }}</h1>
    </div>

    <div class="rounded-xl bg-base-100 px-3 py-2.5">
      <div class="flex items-center gap-3">
        <span class="text-[10.5px] font-medium tracking-wide text-base-content/40">
          {{ t("templates.rulesTitle") }}
        </span>
        <button class="ml-auto text-[11px] text-primary" @click="ruleSheet = 'new'">
          {{ t("templates.addRule") }}
        </button>
      </div>
      <p class="mt-1 text-[10.5px] text-base-content/35">{{ t("templates.rulesHint") }}</p>
      <AnimatePresence as="ul" mode="popLayout" :initial="false" class="mt-1.5 space-y-0.5">
        <motion.li
          v-for="rule in vm.state.rules"
          :key="rule.id"
          v-bind="listItemMotion"
          class="flex items-center gap-2 rounded-lg px-1 py-1 text-[12.5px] hover:bg-base-200"
        >
          <span class="min-w-0 truncate">{{ rule.title }}</span>
          <span class="shrink-0 text-[10.5px] text-base-content/45">{{ ruleSummary(rule) }}</span>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <input
              type="checkbox"
              class="toggle toggle-xs"
              :checked="rule.enabled"
              :aria-label="
                t(rule.enabled ? 'templates.disableAria' : 'templates.enableAria', {
                  title: rule.title,
                })
              "
              @change="toggleRule(rule)"
            />
            <button
              class="text-[11px] text-base-content/45 hover:text-base-content"
              @click="ruleSheet = rule"
            >
              {{ t("common.edit") }}
            </button>
            <button
              class="text-[11px] text-base-content/45 hover:text-error"
              @click="removeRule(rule)"
            >
              {{ t("common.delete") }}
            </button>
          </div>
        </motion.li>
      </AnimatePresence>
      <p
        v-if="!vm.state.rules.length && !vm.state.loading"
        class="mt-1 px-1 text-[11px] text-base-content/35"
      >
        {{ t("templates.emptyRules") }}
      </p>
    </div>

    <div class="rounded-xl bg-base-100 px-3 py-2.5">
      <div class="flex items-center gap-3">
        <span class="text-[10.5px] font-medium tracking-wide text-base-content/40">
          {{ t("templates.templatesTitle") }}
        </span>
        <button class="ml-auto text-[11px] text-primary" @click="templateSheet = 'new'">
          {{ t("templates.addTemplate") }}
        </button>
      </div>
      <p class="mt-1 text-[10.5px] text-base-content/35">{{ t("templates.templatesHint") }}</p>
      <AnimatePresence as="ul" mode="popLayout" :initial="false" class="mt-1.5 space-y-0.5">
        <motion.li
          v-for="template in vm.state.templates"
          :key="template.id"
          v-bind="listItemMotion"
          class="flex items-center gap-2 rounded-lg px-1 py-1 text-[12.5px] hover:bg-base-200"
        >
          <span class="min-w-0 truncate">{{ template.name }}</span>
          <span class="shrink-0 text-[10.5px] text-base-content/45">
            {{ formatEffort(template.effortMinutes) }}
            <template v-if="template.steps.length">
              · {{ t("templates.stepCount", { count: template.steps.length }) }}
            </template>
          </span>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <button class="text-[11px] text-primary" @click="useTemplate(template)">
              {{ t("templates.use") }}
            </button>
            <button
              class="text-[11px] text-base-content/45 hover:text-base-content"
              @click="templateSheet = template"
            >
              {{ t("common.edit") }}
            </button>
            <button
              class="text-[11px] text-base-content/45 hover:text-error"
              @click="removeTemplate(template)"
            >
              {{ t("common.delete") }}
            </button>
          </div>
        </motion.li>
      </AnimatePresence>
      <p
        v-if="!vm.state.templates.length && !vm.state.loading"
        class="mt-1 px-1 text-[11px] text-base-content/35"
      >
        {{ t("templates.emptyTemplates") }}
      </p>
    </div>

    <AnimatePresence>
      <RuleSheet
        v-if="ruleSheet"
        :rule="ruleSheet === 'new' ? null : ruleSheet"
        @close="ruleSheet = null"
      />
    </AnimatePresence>
    <AnimatePresence>
      <TemplateSheet
        v-if="templateSheet"
        :template="templateSheet === 'new' ? null : templateSheet"
        @close="templateSheet = null"
      />
    </AnimatePresence>
    <AnimatePresence>
      <TaskSheet v-if="taskSheetVM.state.openId" />
    </AnimatePresence>
  </section>
</template>

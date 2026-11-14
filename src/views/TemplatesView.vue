<script setup lang="ts">
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, onUnmounted } from "vue";
import { askConfirm, runWithNotice } from "../lib/dialog";
import { t } from "../lib/i18n";
import { formatEffort } from "../lib/effort";
import { listItemMotion } from "../lib/motion";
import { ruleSummary } from "../lib/rules";
import type { TaskRule, TaskTemplate } from "../model/types";
import { usePageHeader } from "../viewmodels/pageHeaderVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { templatesVM as vm } from "../viewmodels/templatesVM";
import RuleSheet from "./overlays/RuleSheet.vue";
import TaskSheet from "./overlays/TaskSheet.vue";
import TemplateSheet from "./overlays/TemplateSheet.vue";

// The open sheet lives in the viewmodel, so the app-wide Ctrl+N guard and closeOverlays
// can see it; a local ref would be invisible to both.
const ruleSheet = computed(() => vm.state.ruleSheet);
const templateSheet = computed(() => vm.state.templateSheet);
usePageHeader(() => ({
  title: t("templates.title"),
  context: `${vm.state.rules.length} ${t("templates.rulesTitle")} · ${vm.state.templates.length} ${t("templates.templatesTitle")}`,
}));

onMounted(() => void vm.load());
// Leaving the page must not leave a sheet mounted over the next one.
onUnmounted(() => vm.closeSheets());

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
    <div class="rounded-xl bg-base-100 px-3 py-2.5">
      <div class="flex items-center gap-3">
        <span class="text-[12px] font-medium tracking-wide text-base-content/60">
          {{ t("templates.rulesTitle") }}
        </span>
        <button class="ml-auto text-[12px] text-primary" @click="vm.openRule('new')">
          {{ t("templates.addRule") }}
        </button>
      </div>
      <p class="mt-1 text-[12px] text-base-content/60">{{ t("templates.rulesHint") }}</p>
      <AnimatePresence as="ul" mode="popLayout" :initial="false" class="mt-1.5 space-y-0.5">
        <motion.li
          v-for="rule in vm.state.rules"
          :key="rule.id"
          v-bind="listItemMotion"
          class="flex items-center gap-2 rounded-lg px-1 py-1 text-[13px] hover:bg-base-200"
        >
          <span class="min-w-0 truncate">{{ rule.title }}</span>
          <span class="shrink-0 text-[12px] text-base-content/65">{{ ruleSummary(rule) }}</span>
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
              class="text-[12px] text-base-content/65 hover:text-base-content"
              @click="vm.openRule(rule)"
            >
              {{ t("common.edit") }}
            </button>
            <button
              class="text-[12px] text-base-content/65 hover:text-error"
              @click="removeRule(rule)"
            >
              {{ t("common.delete") }}
            </button>
          </div>
        </motion.li>
      </AnimatePresence>
      <p
        v-if="!vm.state.rules.length && !vm.state.loading"
        class="mt-1 px-1 text-[12px] text-base-content/60"
      >
        {{ t("templates.emptyRules") }}
      </p>
    </div>

    <div class="rounded-xl bg-base-100 px-3 py-2.5">
      <div class="flex items-center gap-3">
        <span class="text-[12px] font-medium tracking-wide text-base-content/60">
          {{ t("templates.templatesTitle") }}
        </span>
        <button class="ml-auto text-[12px] text-primary" @click="vm.openTemplate('new')">
          {{ t("templates.addTemplate") }}
        </button>
      </div>
      <p class="mt-1 text-[12px] text-base-content/60">{{ t("templates.templatesHint") }}</p>
      <AnimatePresence as="ul" mode="popLayout" :initial="false" class="mt-1.5 space-y-0.5">
        <motion.li
          v-for="template in vm.state.templates"
          :key="template.id"
          v-bind="listItemMotion"
          class="flex items-center gap-2 rounded-lg px-1 py-1 text-[13px] hover:bg-base-200"
        >
          <span class="min-w-0 truncate">{{ template.name }}</span>
          <span class="shrink-0 text-[12px] text-base-content/65">
            {{ formatEffort(template.effortMinutes) }}
            <template v-if="template.steps.length">
              · {{ t("templates.stepCount", { count: template.steps.length }) }}
            </template>
          </span>
          <div class="ml-auto flex shrink-0 items-center gap-2">
            <button class="text-[12px] text-primary" @click="useTemplate(template)">
              {{ t("templates.use") }}
            </button>
            <button
              class="text-[12px] text-base-content/65 hover:text-base-content"
              @click="vm.openTemplate(template)"
            >
              {{ t("common.edit") }}
            </button>
            <button
              class="text-[12px] text-base-content/65 hover:text-error"
              @click="removeTemplate(template)"
            >
              {{ t("common.delete") }}
            </button>
          </div>
        </motion.li>
      </AnimatePresence>
      <p
        v-if="!vm.state.templates.length && !vm.state.loading"
        class="mt-1 px-1 text-[12px] text-base-content/60"
      >
        {{ t("templates.emptyTemplates") }}
      </p>
    </div>

    <AnimatePresence>
      <RuleSheet
        v-if="ruleSheet"
        :rule="ruleSheet === 'new' ? null : ruleSheet"
        @close="vm.state.ruleSheet = null"
      />
    </AnimatePresence>
    <AnimatePresence>
      <TemplateSheet
        v-if="templateSheet"
        :template="templateSheet === 'new' ? null : templateSheet"
        @close="vm.state.templateSheet = null"
      />
    </AnimatePresence>
    <AnimatePresence>
      <TaskSheet v-if="taskSheetVM.state.openId" key="task-sheet" />
    </AnimatePresence>
  </section>
</template>

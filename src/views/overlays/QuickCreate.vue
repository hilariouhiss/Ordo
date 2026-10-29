<script setup lang="ts">
import { X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, nextTick, ref, watch } from "vue";
import type { CaptureSubmission } from "../../lib/capture";
import { errorText, t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { backdropMotion, modalPanelMotion } from "../../lib/motion";
import { quickCreateVM as vm } from "../../viewmodels/quickCreateVM";
import CaptureBar from "../components/CaptureBar.vue";

const mode = computed(() => vm.state.mode);
const taskDraft = ref("");
const projectName = ref("");
const bar = ref<InstanceType<typeof CaptureBar> | null>(null);
const projectInput = ref<HTMLInputElement | null>(null);

watch(mode, async (next) => {
  if (!next) return;
  taskDraft.value = "";
  projectName.value = "";
  await nextTick();
  if (next === "task") bar.value?.focus();
  else projectInput.value?.focus();
});

const warning = computed(() => (vm.state.error ? errorText(vm.state.error) : ""));

function close(): void {
  if (!vm.state.busy) vm.close();
}

async function submitTask(submission: CaptureSubmission): Promise<void> {
  if (await vm.createTask(submission)) taskDraft.value = "";
}

function onProjectEnter(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void submitProject();
}

async function submitProject(): Promise<void> {
  if (await vm.createProject(projectName.value)) projectName.value = "";
}
</script>

<template>
  <AnimatePresence>
    <motion.div
      v-if="mode"
      v-bind="backdropMotion"
      class="window-scrim fixed inset-0 z-[80] flex items-center justify-center bg-neutral/40 p-4"
      @click.self="close"
      @keydown.esc="close"
    >
      <motion.div
        v-bind="modalPanelMotion"
        role="dialog"
        aria-modal="true"
        :aria-label="mode === 'task' ? t('quickCreate.taskTitle') : t('quickCreate.projectTitle')"
        class="max-h-[86vh] w-full overflow-y-auto rounded-2xl bg-base-100 p-4 shadow-2xl"
        :class="mode === 'task' ? 'max-w-[560px]' : 'max-w-[400px]'"
      >
        <div class="flex items-center">
          <h2 class="text-[14px] font-semibold">
            {{ mode === "task" ? t("quickCreate.taskTitle") : t("quickCreate.projectTitle") }}
          </h2>
          <button
            class="ml-auto grid size-6 place-items-center rounded-md text-base-content/40 hover:bg-base-200 hover:text-base-content"
            :aria-label="t('common.close')"
            @click="close"
          >
            <X :size="15" aria-hidden="true" />
          </button>
        </div>

        <template v-if="mode === 'task'">
          <div class="mt-3 rounded-xl border border-base-300 bg-base-200/40 p-1">
            <CaptureBar ref="bar" v-model="taskDraft" @submit="submitTask" />
          </div>
        </template>
        <input
          v-else
          ref="projectInput"
          v-model="projectName"
          class="input input-sm mt-3 w-full rounded-lg border-base-300 text-[12.5px]"
          :placeholder="t('projects.placeholder')"
          :aria-label="t('quickCreate.projectTitle')"
          @keydown.enter="onProjectEnter"
        />

        <p v-if="warning" class="mt-2 text-[11px] text-error">{{ warning }}</p>

        <div class="mt-4 flex justify-end gap-2">
          <button
            class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
            @click="close"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            v-if="mode === 'task'"
            class="btn btn-sm rounded-lg border-0 bg-primary text-primary-content"
            :disabled="vm.state.busy || !taskDraft.trim()"
            @click="bar?.submit()"
          >
            {{ t("quickCreate.create") }}
          </button>
          <button
            v-else
            class="btn btn-sm rounded-lg border-0 bg-primary text-primary-content"
            :disabled="vm.state.busy || !projectName.trim()"
            @click="submitProject"
          >
            {{ t("quickCreate.create") }}
          </button>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
</template>

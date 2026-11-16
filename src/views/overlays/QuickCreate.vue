<script setup lang="ts">
import { X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, nextTick, ref, watch } from "vue";
import { errorText, t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { backdropMotion, modalPanelMotion } from "../../lib/motion";
import { quickCreateVM as vm } from "../../viewmodels/quickCreateVM";

const mode = computed(() => vm.state.mode);
const projectName = ref("");
const projectInput = ref<HTMLInputElement | null>(null);

watch(mode, async (next) => {
  if (!next) return;
  projectName.value = "";
  await nextTick();
  projectInput.value?.focus();
});

const warning = computed(() => (vm.state.error ? errorText(vm.state.error) : ""));

function close(): void {
  if (!vm.state.busy) vm.close();
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
        :aria-label="t('quickCreate.projectTitle')"
        class="flex max-h-[86vh] w-full max-w-[400px] flex-col overflow-hidden rounded-2xl bg-base-100 shadow-2xl"
      >
        <div class="flex shrink-0 items-center px-4 pt-4">
          <h2 class="text-[14px] font-semibold">{{ t("quickCreate.projectTitle") }}</h2>
          <button
            class="ml-auto grid size-6 place-items-center rounded-md text-base-content/60 hover:bg-base-200 hover:text-base-content"
            :aria-label="t('common.close')"
            @click="close"
          >
            <X :size="15" aria-hidden="true" />
          </button>
        </div>

        <div class="min-h-0 overflow-y-auto px-4 pb-4">
          <input
            ref="projectInput"
            v-model="projectName"
            class="input input-sm mt-3 w-full rounded-lg border-base-300 text-[13px]"
            :placeholder="t('projects.placeholder')"
            :aria-label="t('quickCreate.projectTitle')"
            @keydown.enter="onProjectEnter"
          />

          <p v-if="warning" class="mt-2 text-[12px] text-error">{{ warning }}</p>

          <div class="mt-4 flex justify-end gap-2">
            <button
              class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
              @click="close"
            >
              {{ t("common.cancel") }}
            </button>
            <button
              class="btn btn-sm rounded-lg border-0 bg-base-content text-base-100"
              :disabled="vm.state.busy || !projectName.trim()"
              @click="submitProject"
            >
              {{ t("quickCreate.create") }}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
</template>

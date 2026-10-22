<script setup lang="ts">
import { AnimatePresence, motion } from "motion-v";
import { nextTick, ref, watch } from "vue";
import { todayIso } from "../../lib/dates";
import { closeDialog, dialogRequest } from "../../lib/dialog";
import { t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { backdropMotion, modalPanelMotion } from "../../lib/motion";
import DateField from "../components/DateField.vue";

const draft = ref("");
const reasonDraft = ref("");
const untilDraft = ref("");
const textInput = ref<HTMLInputElement | null>(null);
const reasonInput = ref<HTMLInputElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);

watch(dialogRequest, async (request) => {
  if (!request) return;
  await nextTick();
  if (request.kind === "text") {
    draft.value = request.value;
    await nextTick();
    textInput.value?.select();
  } else if (request.kind === "suspend") {
    reasonDraft.value = "";
    untilDraft.value = "";
    await nextTick();
    reasonInput.value?.focus();
  } else {
    confirmButton.value?.focus();
  }
});

function confirm(): void {
  const request = dialogRequest.value;
  if (!request) return;
  if (request.kind === "confirm") {
    closeDialog("ok");
    return;
  }
  if (request.kind === "suspend") {
    closeDialog({ reason: reasonDraft.value.trim(), until: untilDraft.value });
    return;
  }
  const value = draft.value.trim();
  if (!value) return;
  closeDialog(value);
}

function onEnter(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  confirm();
}
</script>

<template>
  <AnimatePresence>
    <motion.div
      v-if="dialogRequest"
      v-bind="backdropMotion"
      class="fixed inset-0 z-70 flex items-center justify-center bg-neutral/40 p-4"
      @click.self="closeDialog(null)"
      @keydown.esc="closeDialog(null)"
    >
      <motion.div
        v-bind="modalPanelMotion"
        role="dialog"
        aria-modal="true"
        :aria-label="dialogRequest.title"
        class="w-full max-w-[340px] rounded-2xl bg-base-100 p-5 shadow-2xl"
      >
        <h2 class="text-[15px] font-semibold">{{ dialogRequest.title }}</h2>
        <template v-if="dialogRequest.kind === 'suspend'">
          <label class="mt-3 block text-[11px] text-base-content/45">
            {{ t("task.suspendReasonLabel") }}
            <input
              ref="reasonInput"
              v-model="reasonDraft"
              class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
              :placeholder="t('task.suspendReasonPlaceholder')"
              @keydown.enter="onEnter"
            />
          </label>
          <label class="mt-2 block text-[11px] text-base-content/45">
            {{ t("task.suspendUntilLabel") }}
            <DateField
              v-model="untilDraft"
              :min="todayIso()"
              :aria-label="t('task.suspendUntilLabel')"
              class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
              @enter="confirm"
            />
          </label>
        </template>
        <input
          v-else-if="dialogRequest.kind === 'text'"
          ref="textInput"
          v-model="draft"
          class="input input-sm mt-3 w-full rounded-lg border-base-300 text-[12.5px]"
          @keydown.enter="onEnter"
        />
        <p v-else class="mt-2 text-[12.5px] leading-relaxed text-base-content/60">
          {{ dialogRequest.message }}
        </p>

        <div class="mt-5 flex justify-end gap-2">
          <button
            class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
            @click="closeDialog(null)"
          >
            {{ t("dialog.cancel") }}
          </button>
          <button
            ref="confirmButton"
            class="btn btn-sm rounded-lg border-0"
            :class="
              dialogRequest.kind === 'confirm'
                ? 'bg-error text-error-content'
                : 'bg-primary text-primary-content'
            "
            @click="confirm"
          >
            {{ t("dialog.ok") }}
          </button>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
</template>

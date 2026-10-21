<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import { closeDialog, dialogRequest } from "../../lib/dialog";
import { isImeEnter } from "../../lib/keys";

const draft = ref("");
const input = ref<HTMLInputElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);

watch(dialogRequest, async (request) => {
  if (!request) return;
  await nextTick();
  if (request.kind === "text") {
    draft.value = request.value;
    await nextTick();
    input.value?.select();
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
  <div
    v-if="dialogRequest"
    class="fixed inset-0 z-70 flex items-center justify-center bg-neutral/40 p-4"
    @click.self="closeDialog(null)"
    @keydown.esc="closeDialog(null)"
  >
    <div
      role="dialog"
      aria-modal="true"
      :aria-label="dialogRequest.title"
      class="w-full max-w-[340px] rounded-2xl bg-base-100 p-5 shadow-2xl"
    >
      <h2 class="text-[15px] font-semibold">{{ dialogRequest.title }}</h2>
      <input
        v-if="dialogRequest.kind === 'text'"
        ref="input"
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
          取消
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
          确定
        </button>
      </div>
    </div>
  </div>
</template>

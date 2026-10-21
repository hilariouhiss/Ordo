<script setup lang="ts">
import { t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";

const model = defineModel<string>({ required: true });
const emit = defineEmits<{ submit: [string] }>();

function onSubmit(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  emit("submit", model.value);
}
</script>

<template>
  <div class="flex items-center gap-2 rounded-xl bg-base-100 px-4 py-2.5">
    <input
      v-model="model"
      class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/40"
      :placeholder="t('capture.placeholder')"
      @keydown.enter="onSubmit"
    />
    <span class="shrink-0 text-[10.5px] text-base-content/35">{{ t("capture.saveHint") }}</span>
  </div>
</template>

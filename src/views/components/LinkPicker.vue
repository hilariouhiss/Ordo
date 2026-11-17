<script setup lang="ts">
import { Check } from "@lucide/vue";
import { computed, ref } from "vue";
import { t } from "../../lib/i18n";

const props = defineProps<{
  options: { value: string; label: string }[];
  checked: string[];
}>();
const emit = defineEmits<{ toggle: [value: string]; close: [] }>();

const query = ref("");
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  if (!needle) return props.options;
  return props.options.filter((option) => option.label.toLowerCase().includes(needle));
});
</script>

<template>
  <div
    class="absolute top-full left-0 z-30 mt-1 w-72 rounded-xl border border-base-300 bg-base-100 p-2 shadow-2xl"
  >
    <div class="flex items-center gap-2">
      <input
        v-model="query"
        class="input input-xs min-w-0 flex-1 rounded-md border-base-300"
        :placeholder="t('requirements.pickerSearch')"
        :aria-label="t('requirements.pickerSearch')"
        @keydown.esc="emit('close')"
      />
      <button
        type="button"
        class="btn btn-xs shrink-0 rounded-md border-0 bg-base-content text-base-100"
        @click="emit('close')"
      >
        {{ t("requirements.pickerDone") }}
      </button>
    </div>
    <div class="mt-1 max-h-56 overflow-y-auto">
      <button
        v-for="option in filtered"
        :key="option.value"
        type="button"
        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] hover:bg-base-200"
        :aria-pressed="checked.includes(option.value)"
        @click="emit('toggle', option.value)"
      >
        <span
          class="flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border"
          :class="
            checked.includes(option.value)
              ? 'border-primary bg-primary text-primary-content'
              : 'border-base-300'
          "
        >
          <Check v-if="checked.includes(option.value)" :size="10" aria-hidden="true" />
        </span>
        <span class="min-w-0 flex-1 truncate">{{ option.label }}</span>
      </button>
      <p v-if="!filtered.length" class="px-2 py-2 text-[12px] text-base-content/50">
        {{ t("requirements.pickerEmpty") }}
      </p>
    </div>
  </div>
</template>

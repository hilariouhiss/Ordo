<script setup lang="ts">
/** The two-view switch the week and task pages share, so they look and feel the same. */
defineProps<{
  options: { value: string; label: string }[];
  modelValue: string;
  label: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();
</script>

<template>
  <div
    role="tablist"
    :aria-label="label"
    class="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-base-300 bg-base-100 p-0.5"
  >
    <button
      v-for="option in options"
      :key="option.value"
      role="tab"
      :aria-selected="modelValue === option.value"
      class="rounded px-2.5 py-1 text-[12px] leading-none"
      :class="
        modelValue === option.value
          ? 'bg-base-300 font-medium text-base-content'
          : 'text-base-content/65 hover:text-base-content'
      "
      @click="emit('update:modelValue', option.value)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

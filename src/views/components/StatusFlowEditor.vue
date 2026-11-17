<script setup lang="ts">
import { Plus, X } from "@lucide/vue";
import { t } from "../../lib/i18n";
import type { PipelineEntry } from "../../viewmodels/requirementsVM";

const props = defineProps<{ modelValue: PipelineEntry[] }>();
const emit = defineEmits<{ "update:modelValue": [rows: PipelineEntry[]] }>();

function commit(rows: PipelineEntry[]): void {
  emit("update:modelValue", rows);
}

function rename(index: number, event: Event): void {
  const name = (event.target as HTMLInputElement).value;
  commit(props.modelValue.map((row, position) => (position === index ? { ...row, name } : row)));
}

function add(): void {
  commit([...props.modelValue, { id: null, name: "" }]);
}

function remove(index: number): void {
  if (props.modelValue.length <= 1) return;
  commit(props.modelValue.filter((_, position) => position !== index));
}

function move(index: number, delta: -1 | 1): void {
  const target = index + delta;
  if (target < 0 || target >= props.modelValue.length) return;
  const rows = [...props.modelValue];
  const [row] = rows.splice(index, 1);
  rows.splice(target, 0, row);
  commit(rows);
}
</script>

<template>
  <div>
    <div
      v-for="(row, index) in modelValue"
      :key="index"
      class="flex items-center gap-2 border-b border-base-200 py-1.5"
    >
      <span class="w-4 shrink-0 text-[11px] tabular-nums text-base-content/35">{{
        index + 1
      }}</span>
      <input
        :value="row.name"
        class="input input-xs min-w-0 flex-1 rounded-md border-base-300 bg-base-100"
        :placeholder="t('requirements.statusNamePlaceholder')"
        :aria-label="t('requirements.statusNamePlaceholder')"
        @input="rename(index, $event)"
      />
      <button
        type="button"
        class="shrink-0 text-base-content/45 hover:text-base-content disabled:opacity-30"
        :disabled="index === 0"
        :aria-label="t('requirements.moveUpAria')"
        @click="move(index, -1)"
      >
        <span class="text-[11px]">↑</span>
      </button>
      <button
        type="button"
        class="shrink-0 text-base-content/45 hover:text-base-content disabled:opacity-30"
        :disabled="index === modelValue.length - 1"
        :aria-label="t('requirements.moveDownAria')"
        @click="move(index, 1)"
      >
        <span class="text-[11px]">↓</span>
      </button>
      <button
        type="button"
        class="shrink-0 text-base-content/35 hover:text-error disabled:opacity-30"
        :disabled="modelValue.length <= 1"
        :aria-label="t('requirements.deleteStatusAria', { name: row.name })"
        @click="remove(index)"
      >
        <X :size="12" aria-hidden="true" />
      </button>
    </div>
    <button
      type="button"
      class="mt-2 flex items-center gap-1 text-[12px] text-base-content/65 hover:text-base-content"
      @click="add"
    >
      <Plus :size="11" aria-hidden="true" />
      {{ t("requirements.addStatus") }}
    </button>
  </div>
</template>

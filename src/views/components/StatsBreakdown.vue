<script setup lang="ts">
import { computed } from "vue";
import { t } from "../../lib/i18n";
import { breakdownRows, personDays } from "../../lib/stats";
import type { StatsSlice } from "../../model/types";

const props = defineProps<{
  title: string;
  slices: StatsSlice[];
  /** Shown when no completed task carries this attribute. */
  emptyText: string;
  animate: boolean;
}>();

const rows = computed(() => breakdownRows(props.slices, 4));

const peak = computed(() => rows.value.reduce((max, row) => Math.max(max, row.completed), 1));

function rowName(name: string | null, merged: boolean): string {
  if (merged) return t("stats.other");
  return name ?? t("common.uncategorized");
}

function width(completed: number): string {
  return Math.max(4, (completed / peak.value) * 100) + "%";
}
</script>

<template>
  <div class="rounded-xl bg-base-100 p-3">
    <div class="mb-2 flex items-baseline gap-3">
      <h2 class="text-[12.5px] font-semibold">{{ title }}</h2>
      <span class="ml-auto text-[11px] text-base-content/40">{{ t("stats.sliceUnit") }}</span>
    </div>

    <p v-if="!rows.length" class="py-1 text-[11.5px] text-base-content/40">{{ emptyText }}</p>

    <div v-else class="flex flex-col gap-1.5">
      <div
        v-for="(row, index) in rows"
        :key="index"
        class="grid grid-cols-[minmax(0,92px)_minmax(0,1fr)_24px_34px] items-center gap-2 text-[11.5px]"
      >
        <span
          class="truncate"
          :class="row.merged ? 'text-base-content/40' : 'text-base-content/55'"
          :title="rowName(row.name, row.merged)"
        >
          {{ rowName(row.name, row.merged) }}
        </span>
        <span class="h-1.5 overflow-hidden rounded-full bg-base-content/8">
          <i
            class="block h-full rounded-full origin-left"
            :class="row.merged ? 'bg-primary/35' : 'bg-primary'"
            :style="{
              width: animate ? width(row.completed) : '0%',
              transition: animate
                ? `width 460ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 45}ms`
                : 'none',
            }"
          ></i>
        </span>
        <span class="text-right font-medium tabular-nums">{{ row.completed }}</span>
        <span class="text-right text-[11px] tabular-nums text-base-content/40">
          {{ t("stats.personDays", { value: personDays(row.minutes) }) }}
        </span>
      </div>
    </div>
  </div>
</template>

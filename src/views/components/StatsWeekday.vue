<script setup lang="ts">
import { computed } from "vue";
import { t, type MessageKey } from "../../lib/i18n";

const props = defineProps<{
  totals: number[];
  animate: boolean;
}>();

const WEEKDAYS: MessageKey[] = [
  "date.mon",
  "date.tue",
  "date.wed",
  "date.thu",
  "date.fri",
  "date.sat",
  "date.sun",
];

const peak = computed(() => props.totals.reduce((max, value) => Math.max(max, value), 1));

function height(value: number): string {
  return value > 0 ? Math.max(3, (value / peak.value) * 100) + "%" : "0%";
}
</script>

<template>
  <div class="rounded-xl bg-base-100 p-3">
    <div class="mb-2 flex items-baseline gap-3">
      <h2 class="text-[12.5px] font-semibold">{{ t("stats.weekday") }}</h2>
      <span class="ml-auto text-[11px] text-base-content/40">{{ t("stats.weekdayHint") }}</span>
    </div>

    <div
      class="grid grid-cols-7 gap-1.5"
      role="img"
      :aria-label="
        t('stats.chartAria', {
          title: t('stats.weekday'),
          count: totals.reduce((sum, v) => sum + v, 0),
        })
      "
    >
      <div
        v-for="(total, index) in totals"
        :key="index"
        class="flex min-w-0 flex-col items-center gap-1.5"
      >
        <div class="flex h-[76px] w-full items-end justify-center">
          <i
            class="block w-[58%] max-w-[40px] origin-bottom rounded-t-md bg-primary/55"
            :style="{
              height: animate ? height(total) : '0%',
              transition: animate
                ? `height 460ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 40}ms`
                : 'none',
            }"
          ></i>
        </div>
        <span class="text-[10.5px] text-base-content/40">{{ t(WEEKDAYS[index]) }}</span>
        <span class="text-[11.5px] font-medium tabular-nums">{{ total }}</span>
      </div>
    </div>
  </div>
</template>

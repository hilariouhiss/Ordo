<script setup lang="ts">
import { computed } from "vue";
import { t } from "../../lib/i18n";
import type { HeatmapRow } from "../../lib/stats";
import type { MessageKey } from "../../lib/i18n";

const props = defineProps<{
  rows: HeatmapRow[];
  weeks: string[];
  peak: { date: string; completed: number } | null;
  /** The calendar shape for a few weeks, the weekday strip for longer ranges. */
  compact: boolean;
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

const max = computed(() => props.peak?.completed ?? 0);
/** Five steps from "nothing" to "the busiest day", so both themes read the same. */
const LEVELS = [0, 1, 2, 3, 4] as const;

function level(value: number): number {
  if (value <= 0 || max.value <= 0) return 0;
  const ratio = value / max.value;
  if (ratio <= 0.3) return 1;
  if (ratio <= 0.55) return 2;
  if (ratio <= 0.8) return 3;
  return 4;
}

const LEVEL_CLASS: Record<number, string> = {
  0: "bg-base-content/8",
  1: "bg-primary/25",
  2: "bg-primary/45",
  3: "bg-primary/70",
  4: "bg-primary",
};

function cellClass(value: number): string {
  return LEVEL_CLASS[level(value)];
}

/**
 * A calendar cell needs its own text color on top of the fill: dark ink on the
 * light steps, the inverted content color on the deep ones. Days outside the
 * range keep a date but drop the fill so the month stays legible.
 */
function dayClass(value: number): string {
  if (value < 0) return "text-base-content/20";
  const step = level(value);
  return `${LEVEL_CLASS[step]} ${step >= 2 ? "text-primary-content" : "text-base-content/70"}`;
}

function shortDate(iso: string): string {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}

function tip(date: string, value: number): string {
  return `${shortDate(date)} · ${t("stats.trendCompleted")} ${value}`;
}

function delay(index: number): string {
  return props.animate ? `${Math.min(index * 4, 220)}ms` : "0ms";
}

/** Screen readers hear the whole range, not just the busiest day the note names. */
const heatmapAria = computed(() => {
  const total = props.rows.reduce(
    (sum, row) => sum + row.cells.reduce((rowSum, cell) => rowSum + Math.max(0, cell.completed), 0),
    0,
  );
  if (!props.peak) {
    return t("stats.chartAria", { title: t("stats.heatmap"), count: total });
  }
  return t("stats.heatmapAria", {
    title: t("stats.heatmap"),
    count: total,
    date: shortDate(props.peak.date),
    peak: props.peak.completed,
  });
});
</script>

<template>
  <div class="rounded-xl bg-base-100 p-3">
    <div class="mb-2 flex items-baseline gap-3">
      <h2 class="text-[12.5px] font-semibold">{{ t("stats.heatmap") }}</h2>
      <div class="flex items-center gap-1 text-[10.5px] text-base-content/40">
        <span>{{ t("stats.heatmapLess") }}</span>
        <i
          v-for="step in LEVELS"
          :key="step"
          class="size-2.5 rounded-[3px]"
          :class="LEVEL_CLASS[step]"
          aria-hidden="true"
        ></i>
        <span>{{ t("stats.heatmapMore") }}</span>
      </div>
      <span class="ml-auto text-[11px] text-base-content/40">
        {{
          peak
            ? t("stats.heatmapPeak", { date: shortDate(peak.date), count: peak.completed })
            : t("stats.heatmapEmpty")
        }}
      </span>
    </div>

    <!-- Few weeks: a month-style grid, one row per week, one cell per day. -->
    <div v-if="compact" class="grid grid-cols-7 gap-1" role="img" :aria-label="heatmapAria">
      <span v-for="key in WEEKDAYS" :key="key" class="pl-1 text-[10px] text-base-content/40">
        {{ t(key) }}
      </span>
      <template v-for="(week, weekIndex) in weeks" :key="week">
        <div
          v-for="row in rows"
          :key="week + row.weekday"
          class="flex h-[42px] items-end justify-end rounded-md px-1.5 pb-1 text-[10.5px] tabular-nums"
          :class="[dayClass(row.cells[weekIndex].completed), animate ? 'opacity-100' : 'opacity-0']"
          :style="{
            transition: `opacity 260ms ease-out ${delay(weekIndex * 7 + row.weekday)}`,
          }"
          :title="
            row.cells[weekIndex].completed < 0
              ? undefined
              : tip(row.cells[weekIndex].date, row.cells[weekIndex].completed)
          "
        >
          {{ Number(row.cells[weekIndex].date.slice(8)) }}
        </div>
      </template>
    </div>

    <!-- Long ranges: one row per weekday, one square per week. -->
    <div v-else class="flex flex-col gap-[3px]" role="img" :aria-label="heatmapAria">
      <div v-for="row in rows" :key="row.weekday" class="flex items-center gap-[3px]">
        <span class="w-6 shrink-0 text-[10px] leading-none whitespace-nowrap text-base-content/40">
          {{ t(WEEKDAYS[row.weekday]) }}
        </span>
        <div
          class="grid flex-1 gap-[3px]"
          :style="{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }"
        >
          <i
            v-for="(cell, index) in row.cells"
            :key="cell.date"
            class="block h-[11px] rounded-[2.5px]"
            :class="[
              cell.completed < 0 ? 'bg-transparent' : cellClass(cell.completed),
              animate ? 'opacity-100' : 'opacity-0',
            ]"
            :style="{ transition: `opacity 260ms ease-out ${delay(row.weekday * 12 + index * 3)}` }"
            :title="cell.completed < 0 ? undefined : tip(cell.date, cell.completed)"
          ></i>
        </div>
      </div>
    </div>
  </div>
</template>

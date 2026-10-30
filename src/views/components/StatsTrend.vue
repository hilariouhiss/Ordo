<script setup lang="ts">
import { computed } from "vue";
import { t } from "../../lib/i18n";
import { labelStride } from "../../lib/stats";
import type { Granularity, StatsBucket } from "../../lib/stats";

const props = defineProps<{
  buckets: StatsBucket[];
  granularity: Granularity;
  /** Bars animate up from the baseline on entry. */
  animate: boolean;
}>();

/** Round the axis up past the tallest bar so it never touches the ceiling. */
const axisMax = computed(() => {
  const peak = props.buckets.reduce((max, b) => Math.max(max, b.completed, b.created), 0);
  if (peak <= 0) return 1;
  const steps = [2, 4, 6, 8, 10, 12, 16, 20, 24, 30, 40, 60, 80, 100];
  return steps.find((step) => peak < step) ?? Math.ceil((peak + 1) / 50) * 50;
});

const ticks = computed(() => [axisMax.value, Math.round(axisMax.value / 2), 0]);

const stride = computed(() => labelStride(props.buckets.length));

/** Month buckets need the locale's month name; day and week buckets show M/D. */
function label(bucket: StatsBucket): string {
  if (props.granularity !== "month") {
    const [, m, d] = bucket.key.split("-");
    return `${Number(m)}/${Number(d)}`;
  }
  const [year, month] = bucket.key.split("-").map(Number);
  return new Intl.DateTimeFormat(undefined, { month: "short" }).format(
    new Date(year, month - 1, 1),
  );
}

function height(value: number): string {
  if (value <= 0) return "0%";
  return Math.max(2, (value / axisMax.value) * 100) + "%";
}

const total = computed(() => props.buckets.reduce((sum, b) => sum + b.completed, 0));
</script>

<template>
  <div class="rounded-xl bg-base-100 p-3">
    <div class="mb-2 flex items-baseline gap-3">
      <h2 class="text-[12.5px] font-semibold">{{ t("stats.trend") }}</h2>
      <div class="flex items-center gap-3 text-[11px] text-base-content/45">
        <span class="flex items-center gap-1">
          <i class="size-2 rounded-[2px] bg-primary" aria-hidden="true"></i>
          {{ t("stats.trendCompleted") }}
        </span>
        <span class="flex items-center gap-1">
          <i
            class="size-2 rounded-[2px] border border-primary/45 bg-primary/10"
            aria-hidden="true"
          ></i>
          {{ t("stats.trendCreated") }}
        </span>
      </div>
      <span class="ml-auto text-[11px] text-base-content/40">
        {{
          granularity === "day"
            ? t("stats.byDay")
            : granularity === "week"
              ? t("stats.byWeek")
              : t("stats.byMonth")
        }}
      </span>
    </div>

    <div
      class="grid grid-cols-[22px_1fr] gap-x-2 gap-y-1"
      role="img"
      :aria-label="t('stats.chartAria', { title: t('stats.trend'), count: total })"
    >
      <div class="relative h-[132px] text-[10px] text-base-content/40 tabular-nums">
        <span
          v-for="tick in ticks"
          :key="tick"
          class="absolute right-0 translate-y-1/2"
          :style="{ bottom: (tick / axisMax) * 100 + '%' }"
        >
          {{ tick }}
        </span>
      </div>

      <div class="relative h-[132px]">
        <i
          v-for="tick in ticks"
          :key="tick"
          class="absolute inset-x-0 h-px bg-base-content/8"
          :aria-hidden="true"
          :style="{ bottom: (tick / axisMax) * 100 + '%' }"
        ></i>
        <div class="absolute inset-0 flex items-end gap-0.5">
          <div
            v-for="(bucket, index) in buckets"
            :key="bucket.key"
            class="flex h-full min-w-0 flex-1 items-end justify-center gap-0.5"
            :title="`${label(bucket)} · ${t('stats.trendCompleted')} ${bucket.completed} · ${t('stats.trendCreated')} ${bucket.created}`"
          >
            <i
              class="block w-[38%] max-w-[18px] origin-bottom rounded-t-[2px] bg-primary"
              :style="{
                height: animate ? height(bucket.completed) : '0%',
                transition: animate
                  ? `height 420ms cubic-bezier(0.22, 1, 0.36, 1) ${Math.min(index * 8, 240)}ms`
                  : 'none',
              }"
            ></i>
            <i
              class="block w-[38%] max-w-[18px] origin-bottom rounded-t-[2px] border border-primary/45 bg-primary/10"
              :aria-hidden="true"
              :style="{
                height: animate ? height(bucket.created) : '0%',
                transition: animate
                  ? `height 420ms cubic-bezier(0.22, 1, 0.36, 1) ${Math.min(index * 8, 240)}ms`
                  : 'none',
              }"
            ></i>
          </div>
        </div>
      </div>

      <div></div>
      <!-- Labels are drawn every few columns, so let them spill past their tick. -->
      <div class="flex gap-0.5 text-[10px] text-base-content/40">
        <span
          v-for="(bucket, index) in buckets"
          :key="bucket.key"
          class="flex-1 overflow-visible text-center whitespace-nowrap"
        >
          {{ index % stride === 0 ? label(bucket) : "" }}
        </span>
      </div>
    </div>
  </div>
</template>

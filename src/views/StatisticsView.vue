<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { t, type MessageKey } from "../lib/i18n";
import { statsVM, STATS_PRESETS, type StatsPreset } from "../viewmodels/statsVM";
import DateField from "./components/DateField.vue";
import StatsBreakdown from "./components/StatsBreakdown.vue";
import StatsHeatmap from "./components/StatsHeatmap.vue";
import StatsTrend from "./components/StatsTrend.vue";
import StatsWeekday from "./components/StatsWeekday.vue";

const {
  state,
  data,
  span,
  granularity,
  hasActivity,
  compactHeatmap,
  buckets,
  heatmap,
  weekday,
  busiest,
  projects,
  categories,
  rate,
  completedDelta,
  minutesDelta,
  rateDelta,
  delayedDelta,
  completedDays,
  completedHours,
  refresh,
  setPreset,
  setCustom,
} = statsVM;

const PRESET_LABEL: Record<StatsPreset, MessageKey> = {
  "30d": "stats.preset30d",
  "12w": "stats.preset12w",
  year: "stats.presetYear",
  custom: "stats.presetCustom",
};

/**
 * Charts grow in when the page opens — and again when the range changes, so a
 * new range reads as new data rather than a jitter.
 */
const revealed = ref(false);

watch(
  () => state.data,
  async () => {
    revealed.value = false;
    await nextTick();
    revealed.value = true;
  },
  { immediate: true },
);

onMounted(() => void refresh());

// The date fields only write on commit, so this fires once per picked day.
watch(
  () => [state.customFrom, state.customTo],
  ([from, to]) => {
    if (state.preset !== "custom" || !from || !to) return;
    void setCustom(from, to);
  },
);

/** Staggered entrance for the sections under the metric row. */
function revealStyle(index: number): Record<string, string> {
  return {
    opacity: revealed.value ? "1" : "0",
    transform: revealed.value ? "none" : "translateY(6px)",
    transition: `opacity 300ms ease-out ${index * 50}ms, transform 300ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 50}ms`,
  };
}

type Tone = "up" | "down" | "flat" | "none";

function tone(delta: number | null, goodUp: boolean): Tone {
  if (delta === null) return "none";
  if (Math.abs(delta) < 0.05) return "flat";
  return delta > 0 === goodUp ? "up" : "down";
}

const TONE_CLASS: Record<Tone, string> = {
  up: "text-success",
  down: "text-error",
  flat: "text-base-content/40",
  none: "text-base-content/40",
};

/** A zero delta reads as "0", not "−0"; everything else carries its sign. */
function signed(value: number, decimals = 0): string {
  if (Math.abs(value) < 0.05) return "0";
  return (value > 0 ? "+" : "−") + Math.abs(value).toFixed(decimals);
}

const completedSub = computed(() =>
  completedDelta.value === null ? t("stats.previousNone") : signed(completedDelta.value),
);
const minutesSub = computed(() =>
  minutesDelta.value === null ? t("stats.previousNone") : signed(minutesDelta.value, 1),
);
const rateSub = computed(() =>
  data.value.withDue > 0
    ? t("stats.onTimeDetail", { onTime: data.value.onTime, withDue: data.value.withDue })
    : t("stats.noDue"),
);
const rateDeltaText = computed(() => {
  if (rateDelta.value === null) return "";
  if (Math.abs(rateDelta.value) < 0.5) return t("stats.flat");
  return t("stats.points", { value: signed(rateDelta.value) });
});
const delayedSub = computed(() =>
  delayedDelta.value === null ? t("stats.previousNone") : signed(delayedDelta.value),
);

const rangeLabel = computed(() =>
  t("stats.range", { from: state.from, to: state.to, days: span.value }),
);
</script>

<template>
  <section class="space-y-2">
    <div class="flex flex-wrap items-center gap-3">
      <h1 class="text-[16px] font-semibold">{{ t("stats.title") }}</h1>
      <span class="text-[11px] tabular-nums text-base-content/45">{{ rangeLabel }}</span>
      <div class="ml-auto flex flex-wrap gap-1" role="group" :aria-label="t('stats.rangeAria')">
        <button
          v-for="preset in STATS_PRESETS"
          :key="preset"
          type="button"
          class="btn btn-xs rounded-md font-normal"
          :class="
            state.preset === preset
              ? 'border-0 bg-primary text-primary-content'
              : 'border-base-300 bg-base-100'
          "
          :aria-pressed="state.preset === preset"
          @click="void setPreset(preset)"
        >
          {{ t(PRESET_LABEL[preset]) }}
        </button>
      </div>
    </div>

    <div v-if="state.preset === 'custom'" class="flex flex-wrap items-center gap-2">
      <label class="flex items-center gap-1.5 text-[11px] text-base-content/45">
        {{ t("stats.from") }}
        <DateField
          v-model="state.customFrom"
          class="input input-sm w-36 rounded-lg border-base-300"
        />
      </label>
      <label class="flex items-center gap-1.5 text-[11px] text-base-content/45">
        {{ t("stats.to") }}
        <DateField
          v-model="state.customTo"
          class="input input-sm w-36 rounded-lg border-base-300"
        />
      </label>
    </div>

    <template v-if="state.data">
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="flex min-w-0 flex-col gap-0.5 rounded-xl bg-base-100 px-3 py-2.5">
          <span class="text-[11px] text-base-content/45">{{ t("stats.completed") }}</span>
          <span class="flex items-baseline gap-1 text-[22px] font-semibold leading-tight">
            {{ data.completed }}
            <span class="text-[11px] font-normal text-base-content/45">
              {{ t("stats.completedUnit") }}
            </span>
          </span>
          <span class="flex items-baseline gap-1 text-[11px]">
            <span :class="TONE_CLASS[tone(completedDelta, true)]">{{ completedSub }}</span>
            <span class="text-base-content/40">{{ t("stats.vsPrevious") }}</span>
          </span>
        </div>

        <div class="flex min-w-0 flex-col gap-0.5 rounded-xl bg-base-100 px-3 py-2.5">
          <span class="text-[11px] text-base-content/45">{{ t("stats.minutes") }}</span>
          <span class="flex items-baseline gap-1 text-[22px] font-semibold leading-tight">
            {{ completedDays }}
            <span class="text-[11px] font-normal text-base-content/45">
              {{ t("stats.minutesUnit") }}
            </span>
            <span class="text-[11px] font-normal text-base-content/40">
              {{ t("stats.minutesHint", { hours: completedHours }) }}
            </span>
          </span>
          <span class="flex items-baseline gap-1 text-[11px]">
            <span :class="TONE_CLASS[tone(minutesDelta, true)]">{{ minutesSub }}</span>
            <span class="text-base-content/40">{{ t("stats.vsPrevious") }}</span>
          </span>
        </div>

        <div class="flex min-w-0 flex-col gap-0.5 rounded-xl bg-base-100 px-3 py-2.5">
          <span class="text-[11px] text-base-content/45">{{ t("stats.onTime") }}</span>
          <span class="flex items-baseline gap-1 text-[22px] font-semibold leading-tight">
            <template v-if="rate === null">{{ t("common.none") }}</template>
            <template v-else>
              {{ rate }}
              <span class="text-[11px] font-normal text-base-content/45">%</span>
            </template>
          </span>
          <span class="flex items-baseline gap-1 text-[11px]">
            <span v-if="rateDeltaText" :class="TONE_CLASS[tone(rateDelta, true)]">
              {{ rateDeltaText }}
            </span>
            <span class="truncate text-base-content/40">{{ rateSub }}</span>
          </span>
        </div>

        <div class="flex min-w-0 flex-col gap-0.5 rounded-xl bg-base-100 px-3 py-2.5">
          <span class="text-[11px] text-base-content/45">{{ t("stats.delayed") }}</span>
          <span class="flex items-baseline gap-1 text-[22px] font-semibold leading-tight">
            {{ data.delayed }}
            <span class="text-[11px] font-normal text-base-content/45">
              {{ t("stats.delayedUnit") }}
            </span>
          </span>
          <span class="flex items-baseline gap-1 text-[11px]">
            <span :class="TONE_CLASS[tone(delayedDelta, false)]">{{ delayedSub }}</span>
            <span class="text-base-content/40">{{ t("stats.vsPrevious") }}</span>
          </span>
        </div>
      </div>

      <template v-if="hasActivity">
        <div :style="revealStyle(0)">
          <StatsTrend :buckets="buckets" :granularity="granularity" :animate="revealed" />
        </div>

        <div class="grid gap-2 sm:grid-cols-2" :style="revealStyle(1)">
          <StatsBreakdown
            :title="t('stats.byProject')"
            :slices="projects"
            :empty-text="t('stats.sliceEmpty')"
            :animate="revealed"
          />
          <StatsBreakdown
            :title="t('stats.byCategory')"
            :slices="categories"
            :empty-text="t('stats.sliceEmptyCategory')"
            :animate="revealed"
          />
        </div>

        <div :style="revealStyle(2)">
          <StatsHeatmap
            :rows="heatmap.rows"
            :weeks="heatmap.weeks"
            :peak="busiest"
            :compact="compactHeatmap"
            :animate="revealed"
          />
        </div>

        <div :style="revealStyle(3)">
          <StatsWeekday :totals="weekday" :animate="revealed" />
        </div>
      </template>

      <div
        v-else
        class="rounded-xl border border-dashed border-base-content/15 px-4 py-8 text-center"
      >
        <p class="text-[12.5px]">{{ t("stats.empty") }}</p>
        <p class="mt-1 text-[11.5px] text-base-content/45">{{ t("stats.emptyHint") }}</p>
      </div>
    </template>

    <!-- A first read that never landed: say so instead of leaving the page blank. -->
    <p v-else-if="state.failed" class="px-1 text-[13px] text-base-content/40">
      {{ t("stats.loadFailed") }}
    </p>
    <p v-else class="px-1 text-[13px] text-base-content/40">{{ t("stats.loading") }}</p>
  </section>
</template>

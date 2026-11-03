<script setup lang="ts">
import { computed } from "vue";
import { shortDate } from "../../lib/dates";
import { t } from "../../lib/i18n";
import { formatStepClock, stepsInRange } from "../../lib/steps";
import type { Task } from "../../model/types";
import PriorityBadge from "./PriorityBadge.vue";

const props = defineProps<{
  task: Task;
  day: number;
  total: number;
  hours: number;
  end: string;
  /** Where this day starts and ends in the task's effort minutes. */
  from: number;
  to: number;
}>();
const emit = defineEmits<{ open: [Task] }>();

const dayLabel = computed(() => t("task.spanDay", { day: props.day, total: props.total }));
const hoursLabel = computed(() => t("week.dayLoad", { hours: props.hours }));
const daySteps = computed(() =>
  stepsInRange(props.task.effortMinutes, props.task.steps, props.from, props.to),
);
const aria = computed(() => t("week.spanOpenAria", { title: props.task.title }));
const endLabel = computed(() =>
  props.day === props.total
    ? t("task.spanLastDay")
    : t("task.plannedEnd", { date: shortDate(props.end) }),
);

function open(): void {
  // Selecting the title to copy it also ends with a click; that must not open the sheet.
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  emit("open", props.task);
}
</script>

<template>
  <article
    class="relative cursor-pointer rounded-xl bg-base-100 py-3 pr-3 pl-3.5 transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40"
    role="button"
    tabindex="0"
    :aria-label="aria"
    @click="open"
    @keydown.enter.prevent="emit('open', task)"
    @keydown.space.prevent="emit('open', task)"
  >
    <span
      class="absolute inset-y-2 left-1 w-[3px] rounded-full bg-primary/35"
      aria-hidden="true"
    ></span>
    <div class="flex flex-wrap items-center gap-2.5">
      <span class="text-[13px]">{{ task.title }}</span>
      <span
        v-if="task.projectName"
        class="badge badge-soft badge-primary badge-xs max-w-32"
        :title="task.projectName"
      >
        <span class="min-w-0 truncate">{{ task.projectName }}</span>
      </span>
      <PriorityBadge :priority="task.priority" />
      <span class="badge badge-ghost badge-xs">{{ dayLabel }}</span>
      <span class="badge badge-ghost badge-xs">{{ hoursLabel }}</span>
      <span class="ml-auto shrink-0 text-[10px] text-base-content/40">{{ endLabel }}</span>
    </div>
    <p
      v-if="daySteps.length"
      class="flex flex-wrap items-center gap-x-1 text-[10.5px] leading-4 text-base-content/45"
    >
      <span class="text-base-content/35">{{ t("task.daySteps") }}</span>
      <span
        v-for="(slice, index) in daySteps"
        :key="slice.step.id"
        class="flex items-center gap-x-1"
      >
        <span v-if="index" class="text-base-content/25">·</span>
        <span :class="{ 'text-base-content/35 line-through': slice.step.done }">{{
          slice.step.title
        }}</span>
        <span class="font-mono text-[10px] text-base-content/35">{{
          formatStepClock(slice.minutes)
        }}</span>
      </span>
    </p>
  </article>
</template>

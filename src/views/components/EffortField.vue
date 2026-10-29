<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from "vue";
import {
  EFFORT_MAX_MINUTES,
  EFFORT_MIN_MINUTES,
  EFFORT_STEP_MINUTES,
  MINUTES_PER_DAY,
  splitEffort,
} from "../../lib/effort";
import { t } from "../../lib/i18n";

const props = defineProps<{ compact?: boolean }>();
const model = defineModel<number>({ required: true });

type Part = "days" | "hours" | "minutes";

/** Each unit is its own box; arrow keys move it by its own step. */
const PARTS: {
  key: Part;
  unit: "effort.daysUnit" | "effort.hoursUnit" | "effort.minutesUnit";
  step: number;
}[] = [
  { key: "days", unit: "effort.daysUnit", step: MINUTES_PER_DAY },
  { key: "hours", unit: "effort.hoursUnit", step: 60 },
  { key: "minutes", unit: "effort.minutesUnit", step: EFFORT_STEP_MINUTES },
];

const split = computed(() => splitEffort(model.value));
const editing = ref<Part | null>(null);
const drafts = reactive<Record<Part, string>>({ days: "0", hours: "0", minutes: "0" });
const inputs: Partial<Record<Part, HTMLInputElement>> = {};
const setInput = (part: Part, element: unknown): void => {
  if (element instanceof HTMLInputElement) inputs[part] = element;
  else delete inputs[part];
};

watch(
  split,
  (next) => {
    for (const part of PARTS) {
      if (editing.value !== part.key) drafts[part.key] = String(next[part.key]);
    }
  },
  { immediate: true },
);

/** A zero part collapses into a "+ unit" button, so the field only shows what is set. */
function visible(part: Part): boolean {
  return split.value[part] > 0 || editing.value === part;
}

const ghostClass = computed(() =>
  props.compact
    ? "rounded-md px-1 py-0.5 text-[10px] text-base-content/35 hover:bg-base-200 hover:text-base-content/60"
    : "rounded-md px-1 py-0.5 text-[11px] text-base-content/35 hover:bg-base-200 hover:text-base-content/60",
);
const inputClass = computed(() => (props.compact ? "w-5 text-[10.5px]" : "w-6 text-[12.5px]"));
const unitClass = computed(() =>
  props.compact ? "text-[10px] text-base-content/45" : "text-[11px] text-base-content/45",
);
const boxClass = computed(() =>
  props.compact
    ? "flex items-center gap-1 rounded-md border border-base-300 bg-base-100 px-1 py-0.5"
    : "flex items-center gap-1 rounded-lg border border-base-300 bg-base-100 px-1.5 py-1",
);

function start(part: Part): void {
  editing.value = part;
  drafts[part] = String(split.value[part]);
  void nextTick(() => inputs[part]?.focus());
}

function commit(): void {
  const days = Math.max(0, Math.round(Number(drafts.days) || 0));
  const hours = Math.max(0, Math.round(Number(drafts.hours) || 0));
  const minutes = Math.max(0, Math.round(Number(drafts.minutes) || 0));
  const total = days * MINUTES_PER_DAY + hours * 60 + minutes;
  model.value = Math.min(EFFORT_MAX_MINUTES, Math.max(EFFORT_MIN_MINUTES, total));
  editing.value = null;
}

function onKey(event: KeyboardEvent, part: Part): void {
  if (event.isComposing) return;
  if (event.key === "Enter") {
    event.preventDefault();
    commit();
    return;
  }
  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
  event.preventDefault();
  const step = PARTS.find((one) => one.key === part)?.step ?? 1;
  const total = model.value + (event.key === "ArrowUp" ? step : -step);
  model.value = Math.min(EFFORT_MAX_MINUTES, Math.max(EFFORT_MIN_MINUTES, total));
  const next = splitEffort(model.value);
  drafts.days = String(next.days);
  drafts.hours = String(next.hours);
  drafts.minutes = String(next.minutes);
}
</script>

<template>
  <div class="inline-flex items-center gap-1">
    <template v-for="part in PARTS" :key="part.key">
      <div v-if="visible(part.key)" :class="boxClass">
        <input
          :ref="(element) => setInput(part.key, element)"
          v-model="drafts[part.key]"
          inputmode="numeric"
          autocomplete="off"
          :aria-label="t(part.unit)"
          class="bg-transparent text-center tabular-nums outline-none"
          :class="inputClass"
          @focus="start(part.key)"
          @keydown="onKey($event, part.key)"
          @blur="commit"
        />
        <span :class="unitClass">{{ t(part.unit) }}</span>
      </div>
      <button v-else type="button" :class="ghostClass" @click="start(part.key)">
        +{{ t(part.unit) }}
      </button>
    </template>
  </div>
</template>

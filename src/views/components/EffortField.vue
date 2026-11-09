<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { bestEffortUnit, parseEffortAmount, type EffortUnit } from "../../lib/effort";
import { t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import ChipSelect from "./ChipSelect.vue";

/** `optional` lets the field sit empty: 0 means "no value recorded". */
const props = defineProps<{
  compact?: boolean;
  optional?: boolean;
  /** `allowZero` keeps 0 a real value instead (the advance reminder uses it as "off"). */
  allowZero?: boolean;
  label?: string;
  disabled?: boolean;
}>();
const model = defineModel<number>({ required: true });

const root = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const amount = ref("");
const unit = ref<EffortUnit>("minutes");
/** The pair on screen is the draft; the model only changes when the field is left. */
let editing = false;

/** The sheet passes "actual effort" so the field is not announced as the estimate. */
const fieldLabel = computed(() => props.label ?? t("task.effort"));

const unitOptions = computed(() => [
  { value: "days", label: t("effort.daysUnit") },
  { value: "hours", label: t("effort.hoursUnit") },
  { value: "minutes", label: t("effort.minutesUnit") },
]);

/** The amount and the unit share one box: same height, square inner edges, one gap-free join. */
const inputClass = computed(() =>
  props.compact
    ? "input input-xs h-6 w-11 rounded-l-md rounded-r-none border-base-300 bg-base-100 px-1 text-center text-[10.5px] text-inherit tabular-nums"
    : "input input-sm h-8 w-16 rounded-l-lg rounded-r-none border-base-300 bg-base-100 px-1.5 text-center text-[12.5px] text-inherit tabular-nums",
);
const unitClass = computed(() =>
  props.compact
    ? "select select-xs h-6 w-[52px] justify-center rounded-r-md rounded-l-none border-l-0 border-base-300 bg-base-100 text-[10px] text-inherit"
    : "select select-sm h-8 w-14 justify-center rounded-r-lg rounded-l-none border-l-0 border-base-300 bg-base-100 text-[11px] text-inherit",
);

function show(minutes: number): void {
  if (props.optional && minutes <= 0) {
    amount.value = "";
    return;
  }
  if (props.allowZero && minutes === 0) {
    amount.value = "0";
    unit.value = "minutes";
    return;
  }
  const value = bestEffortUnit(minutes);
  amount.value = String(value.amount);
  unit.value = value.unit;
}

watch(
  model,
  (next) => {
    if (!editing) show(next);
  },
  { immediate: true },
);

function commit(): void {
  const text = amount.value.trim();
  // Zero is the caller's own value here, not the field's empty state.
  if (props.allowZero && text !== "" && Number(text) === 0) {
    if (model.value !== 0) model.value = 0;
    show(0);
    return;
  }
  const minutes = parseEffortAmount(amount.value, unit.value);
  if (minutes === null) {
    if (props.optional && !amount.value.trim()) {
      if (model.value !== 0) model.value = 0;
      show(0);
      return;
    }
    show(model.value);
    return;
  }
  if (minutes !== model.value) model.value = minutes;
  show(minutes);
}

function onFocus(): void {
  editing = true;
  inputEl.value?.select();
}

/** Focus inside the unit popup still belongs to this field: the panel is teleported. */
function isUnitPopupFocus(node: EventTarget | null): boolean {
  return node instanceof Element && node.closest('[role="listbox"]') !== null;
}

function onFocusOut(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (next instanceof Node && root.value?.contains(next)) return;
  if (isUnitPopupFocus(next)) return;
  editing = false;
  commit();
}

/** The number stays as it is; only what it counts changes. Switching never converts. */
function onUnit(next: string): void {
  const nextUnit = next as EffortUnit;
  if (nextUnit === unit.value) return;
  unit.value = nextUnit;
  // Pin the pair on screen: the model takes the new reading, but nothing is redrawn in
  // another unit until the field is left.
  editing = true;
  const minutes = parseEffortAmount(amount.value, nextUnit);
  if (minutes !== null && minutes !== model.value) model.value = minutes;
}

function onEnter(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  commit();
}
</script>

<template>
  <div
    ref="root"
    class="inline-flex items-center"
    :class="{ 'opacity-60': props.disabled }"
    @focusout="onFocusOut"
  >
    <input
      ref="inputEl"
      v-model="amount"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      :disabled="props.disabled"
      :aria-label="fieldLabel"
      :class="inputClass"
      @focus="onFocus"
      @keydown.enter="onEnter"
    />
    <ChipSelect
      :model-value="unit"
      :options="unitOptions"
      :label="fieldLabel"
      :disabled="props.disabled"
      :class="unitClass"
      style="padding-inline: 4px"
      @update:model-value="onUnit"
    />
  </div>
</template>

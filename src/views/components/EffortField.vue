<script setup lang="ts">
import { computed, ref, watch } from "vue";
import {
  bestEffortUnit,
  effortAmountIn,
  parseEffortAmount,
  type EffortUnit,
} from "../../lib/effort";
import { t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import ChipSelect from "./ChipSelect.vue";

const props = defineProps<{ compact?: boolean }>();
const model = defineModel<number>({ required: true });

const root = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLInputElement | null>(null);
const amount = ref("");
const unit = ref<EffortUnit>("minutes");
/** The pair on screen is the draft; the model only changes when the field is left. */
let editing = false;
/** Whether the amount text is the user's own, not a converted display. */
const typed = ref(false);

const unitOptions = computed(() => [
  { value: "days", label: t("effort.daysUnit") },
  { value: "hours", label: t("effort.hoursUnit") },
  { value: "minutes", label: t("effort.minutesUnit") },
]);

const inputClass = computed(() =>
  props.compact
    ? "input input-xs w-11 rounded-md border-base-300 bg-base-100 px-1 text-center text-[10.5px] text-inherit tabular-nums"
    : "input input-sm w-16 rounded-lg border-base-300 bg-base-100 px-1.5 text-center text-[12.5px] text-inherit tabular-nums",
);
const unitClass = computed(() =>
  props.compact
    ? "select select-xs w-[52px] rounded-md border-base-300 bg-base-100 pl-1! text-[10px] text-inherit"
    : "select select-sm w-[68px] rounded-lg border-base-300 bg-base-100 pl-1.5 text-[11px] text-inherit",
);

function show(minutes: number): void {
  const value = bestEffortUnit(minutes);
  amount.value = String(value.amount);
  unit.value = value.unit;
  typed.value = false;
}

watch(
  model,
  (next) => {
    if (!editing) show(next);
  },
  { immediate: true },
);

function commit(): void {
  const minutes = parseEffortAmount(amount.value, unit.value);
  if (minutes === null) {
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

function onInput(): void {
  typed.value = true;
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

function onUnit(next: string): void {
  const nextUnit = next as EffortUnit;
  if (nextUnit === unit.value) return;
  if (typed.value) {
    // The typed number is read in the newly chosen unit.
    unit.value = nextUnit;
    return;
  }
  // Browsing the unit of a committed value only changes how it is shown.
  const minutes = parseEffortAmount(amount.value, unit.value) ?? model.value;
  unit.value = nextUnit;
  amount.value = effortAmountIn(minutes, nextUnit);
}

function onEnter(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  commit();
}
</script>

<template>
  <div ref="root" class="inline-flex items-center gap-1" @focusout="onFocusOut">
    <input
      ref="inputEl"
      v-model="amount"
      type="text"
      inputmode="decimal"
      autocomplete="off"
      spellcheck="false"
      :aria-label="t('task.effort')"
      :class="inputClass"
      @input="onInput"
      @focus="onFocus"
      @keydown.enter="onEnter"
    />
    <ChipSelect
      :model-value="unit"
      :options="unitOptions"
      :label="t('task.effort')"
      :class="unitClass"
      @update:model-value="onUnit"
    />
  </div>
</template>

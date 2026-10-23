<script setup lang="ts">
import { Calendar, ChevronLeft, ChevronRight } from "@lucide/vue";
import { computed, nextTick, ref, useAttrs, watch } from "vue";
import {
  formatDateInput,
  monthMatrix,
  monthOf,
  parseDateInput,
  shiftMonth,
  type MonthView,
} from "../../lib/calendar";
import { addDays, todayIso } from "../../lib/dates";
import { language, t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { useAnchorPopup } from "../../lib/useAnchorPopup";

defineOptions({ inheritAttrs: false });

const props = defineProps<{ min?: string }>();
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ enter: [] }>();
const attrs = useAttrs();

const inputEl = ref<HTMLInputElement | null>(null);
const draft = ref(formatDateInput(model.value));
const rootClass = computed(() => attrs.class as string | undefined);
const rootStyle = computed(() => attrs.style as string | undefined);
const inputAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs;
  return rest;
});

watch(model, (value) => {
  draft.value = formatDateInput(value);
});

function commit(): boolean {
  const iso = parseDateInput(draft.value);
  if (iso === null || (iso !== "" && isDisabled(iso))) {
    draft.value = formatDateInput(model.value);
    return false;
  }
  draft.value = formatDateInput(iso);
  if (iso !== model.value) model.value = iso;
  return true;
}

const { open, triggerRef, style, panelId, show, close } = useAnchorPopup({
  onClosed: (restoreFocus) => {
    if (restoreFocus) inputEl.value?.focus();
  },
});

const today = ref(todayIso());
const view = ref<MonthView>(monthOf(today.value));
const focusedIso = ref(today);
const days = computed(() => monthMatrix(view.value.year, view.value.month));
const monthLabel = computed(() =>
  new Intl.DateTimeFormat(language.value === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "long",
  }).format(new Date(view.value.year, view.value.month, 1)),
);
const weekdays = computed(() =>
  (
    ["date.mon", "date.tue", "date.wed", "date.thu", "date.fri", "date.sat", "date.sun"] as const
  ).map((key) => t(key)),
);

const dayRefs = new Map<string, HTMLButtonElement>();

function setDayRef(iso: string, element: unknown): void {
  if (element instanceof HTMLButtonElement) dayRefs.set(iso, element);
  else dayRefs.delete(iso);
}

function isDisabled(iso: string): boolean {
  return Boolean(props.min && iso < props.min);
}

function focusDay(iso: string): void {
  void nextTick(() => dayRefs.get(iso)?.focus());
}

function openCalendar(): void {
  if (open.value) {
    close(true);
    return;
  }
  if (!triggerRef.value) return;
  today.value = todayIso();
  commit();
  const current = model.value || todayIso();
  const start = props.min && current < props.min ? props.min : current;
  view.value = monthOf(start);
  focusedIso.value = start;
  show({ width: 254, height: 312 });
  focusDay(start);
}

function choose(iso: string): void {
  if (isDisabled(iso)) return;
  model.value = iso;
  draft.value = formatDateInput(iso);
  close(true);
}

function clearDate(): void {
  model.value = "";
  draft.value = "";
  close(true);
}

function goToday(): void {
  const iso = todayIso();
  if (!isDisabled(iso)) choose(iso);
}

function moveMonth(delta: number): void {
  const next = shiftMonth(view.value, delta);
  view.value = next;
  const firstEnabled = monthMatrix(next.year, next.month).find(
    (iso): iso is string => iso !== null && !isDisabled(iso),
  );
  if (firstEnabled) {
    focusedIso.value = firstEnabled;
    focusDay(firstEnabled);
  } else {
    focusedIso.value = "";
  }
}

function moveFocus(iso: string): void {
  if (isDisabled(iso)) return;
  focusedIso.value = iso;
  const nextView = monthOf(iso);
  if (nextView.year !== view.value.year || nextView.month !== view.value.month) {
    view.value = nextView;
  }
  focusDay(iso);
}

function onGridKey(event: KeyboardEvent): void {
  if (!focusedIso.value) return;
  const offsets: Record<string, number> = {
    ArrowLeft: -1,
    ArrowRight: 1,
    ArrowUp: -7,
    ArrowDown: 7,
  };
  const offset = offsets[event.key];
  if (offset !== undefined) {
    event.preventDefault();
    moveFocus(addDays(focusedIso.value, offset));
    return;
  }
  if (event.key === "PageUp" || event.key === "PageDown") {
    event.preventDefault();
    moveMonth(event.key === "PageUp" ? -1 : 1);
  }
}

function onInputPointerDown(): void {
  if (open.value) close(false);
}

function onInputEnter(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  if (!commit()) return;
  emit("enter");
}

defineExpose({ focus: () => inputEl.value?.focus() });
</script>

<template>
  <div
    ref="triggerRef"
    class="inline-flex min-w-0 items-center gap-1"
    :class="rootClass"
    :style="rootStyle"
    @click.self="inputEl?.focus()"
  >
    <input
      ref="inputEl"
      v-model="draft"
      v-bind="inputAttrs"
      type="text"
      inputmode="numeric"
      autocomplete="off"
      spellcheck="false"
      :placeholder="t('date.pick')"
      class="min-w-0 flex-1 bg-transparent p-0 text-inherit tabular-nums outline-none [font:inherit] placeholder:text-base-content/40"
      @pointerdown="onInputPointerDown"
      @blur="commit"
      @keydown.enter="onInputEnter"
    />
    <button
      type="button"
      class="shrink-0 cursor-pointer rounded-md p-0.5 text-base-content/40 hover:text-base-content/70"
      :aria-label="t('date.open')"
      :aria-haspopup="'dialog'"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="openCalendar"
    >
      <Calendar :size="12" aria-hidden="true" />
    </button>
  </div>
  <Teleport to="body">
    <div
      v-if="open"
      :id="panelId"
      role="dialog"
      aria-modal="false"
      :aria-label="t('date.pick')"
      :style="style"
      class="fixed z-[90] rounded-xl border border-base-300 bg-base-100 p-2 text-base-content shadow-2xl"
      @click.stop
    >
      <div class="flex items-center gap-1">
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          :aria-label="t('date.prevMonth')"
          @click="moveMonth(-1)"
        >
          <ChevronLeft :size="14" aria-hidden="true" />
        </button>
        <span class="flex-1 text-center text-[12px] font-medium tabular-nums" aria-live="polite">
          {{ monthLabel }}
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-xs btn-square"
          :aria-label="t('date.nextMonth')"
          @click="moveMonth(1)"
        >
          <ChevronRight :size="14" aria-hidden="true" />
        </button>
      </div>
      <div class="mt-1 grid grid-cols-7 gap-y-0.5 text-center text-[10px] text-base-content/40">
        <span v-for="label in weekdays" :key="label">{{ label }}</span>
      </div>
      <div class="mt-0.5 grid grid-cols-7 gap-0.5" @keydown="onGridKey">
        <template v-for="(iso, index) in days" :key="iso ?? `blank-${index}`">
          <button
            v-if="iso"
            :ref="(element) => setDayRef(iso, element)"
            type="button"
            :tabindex="iso === focusedIso ? 0 : -1"
            :disabled="isDisabled(iso)"
            :aria-current="iso === today ? 'date' : undefined"
            :aria-pressed="iso === model"
            class="size-8 rounded-md text-[12px] tabular-nums focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 focus-visible:ring-offset-base-100 focus-visible:outline-none disabled:opacity-25 disabled:hover:bg-transparent"
            :class="{
              'bg-primary text-primary-content hover:bg-primary': iso === model,
              'hover:bg-base-200': iso !== model,
              'font-semibold text-primary': iso === today && iso !== model,
            }"
            @click="choose(iso)"
            @focus="focusedIso = iso"
          >
            {{ Number(iso.slice(8)) }}
          </button>
          <span v-else class="size-8"></span>
        </template>
      </div>
      <div class="mt-2 flex items-center gap-1 border-t border-base-200 pt-2">
        <button
          type="button"
          class="btn btn-ghost btn-xs"
          :disabled="isDisabled(todayIso())"
          @click="goToday"
        >
          {{ t("common.today") }}
        </button>
        <button type="button" class="btn btn-ghost btn-xs ml-auto" @click="clearDate">
          {{ t("date.clear") }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { Clock } from "@lucide/vue";
import { computed, nextTick, ref, useAttrs, watch } from "vue";
import { t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { useAnchorPopup } from "../../lib/useAnchorPopup";

defineOptions({ inheritAttrs: false });

const model = defineModel<string>({ required: true });
const attrs = useAttrs();

const inputEl = ref<HTMLInputElement | null>(null);
const hoursCol = ref<HTMLElement | null>(null);
const minutesCol = ref<HTMLElement | null>(null);
const rootClass = computed(() => attrs.class as string | undefined);
const rootStyle = computed(() => attrs.style as string | undefined);
const inputAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs;
  return rest;
});

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const MINUTES = Array.from({ length: 60 }, (_, minute) => minute);

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Accepts "13:30" and "1330"; minutes must stay inside the hour. */
function parseTime(raw: string): { hour: number; minute: number } | null {
  const text = raw.trim();
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(text) ?? /^(\d{1,2})(\d{2})$/.exec(text);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

const picked = ref(parseTime(model.value) ?? { hour: 9, minute: 0 });
const draft = ref(model.value);

watch(model, (value) => {
  draft.value = value;
  picked.value = parseTime(value) ?? picked.value;
});

const { open, triggerRef, style, panelId, show, close } = useAnchorPopup({
  onClosed: (restoreFocus) => {
    if (restoreFocus) inputEl.value?.focus();
  },
});

function write(hour: number, minute: number): void {
  picked.value = { hour, minute };
  model.value = `${pad(hour)}:${pad(minute)}`;
  draft.value = model.value;
}

function commit(): boolean {
  const parsed = parseTime(draft.value);
  if (!parsed) {
    draft.value = model.value;
    return false;
  }
  write(parsed.hour, parsed.minute);
  return true;
}

function scrollToPicked(): void {
  void nextTick(() => {
    hoursCol.value
      ?.querySelector<HTMLElement>(`[data-hour="${picked.value.hour}"]`)
      ?.scrollIntoView({ block: "center" });
    minutesCol.value
      ?.querySelector<HTMLElement>(`[data-minute="${picked.value.minute}"]`)
      ?.scrollIntoView({ block: "center" });
  });
}

function openPanel(): void {
  if (!triggerRef.value) return;
  if (open.value) {
    close(true);
    return;
  }
  commit();
  picked.value = parseTime(model.value) ?? picked.value;
  show({ width: 210, height: 252 });
  scrollToPicked();
}

function chooseMinute(minute: number): void {
  write(picked.value.hour, minute);
  close(true);
}

function goNow(): void {
  const now = new Date();
  write(now.getHours(), now.getMinutes());
  close(true);
}

function onEnter(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  commit();
}
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
      :placeholder="t('time.pick')"
      class="min-w-0 flex-1 bg-transparent p-0 text-inherit tabular-nums outline-none [font:inherit] placeholder:text-base-content/40"
      @blur="commit"
      @keydown.enter="onEnter"
    />
    <button
      type="button"
      class="shrink-0 cursor-pointer rounded-md p-0.5 text-base-content/40 hover:text-base-content/70"
      :aria-label="t('time.open')"
      aria-haspopup="dialog"
      :aria-expanded="open"
      :aria-controls="panelId"
      @click="openPanel"
    >
      <Clock :size="12" aria-hidden="true" />
    </button>
  </div>

  <Teleport to="body">
    <div
      v-if="open"
      :id="panelId"
      role="dialog"
      aria-modal="false"
      :aria-label="t('time.pick')"
      :style="style"
      class="fixed z-[90] rounded-xl border border-base-300 bg-base-100 p-2 text-base-content shadow-2xl"
      @click.stop
    >
      <div class="grid grid-cols-2 gap-1 text-center text-[10px] text-base-content/40">
        <span>{{ t("time.hour") }}</span>
        <span>{{ t("time.minute") }}</span>
      </div>
      <div class="mt-1 grid grid-cols-2 gap-1">
        <div ref="hoursCol" class="max-h-[168px] overflow-y-auto pr-0.5">
          <button
            v-for="hour in HOURS"
            :key="hour"
            type="button"
            :data-hour="hour"
            :aria-pressed="hour === picked.hour"
            class="block w-full rounded-md py-1 text-center text-[12px] tabular-nums"
            :class="hour === picked.hour ? 'bg-primary text-primary-content' : 'hover:bg-base-200'"
            @click="write(hour, picked.minute)"
          >
            {{ pad(hour) }}
          </button>
        </div>
        <div ref="minutesCol" class="max-h-[168px] overflow-y-auto pr-0.5">
          <button
            v-for="minute in MINUTES"
            :key="minute"
            type="button"
            :data-minute="minute"
            :aria-pressed="minute === picked.minute"
            class="block w-full rounded-md py-1 text-center text-[12px] tabular-nums"
            :class="
              minute === picked.minute ? 'bg-primary text-primary-content' : 'hover:bg-base-200'
            "
            @click="chooseMinute(minute)"
          >
            {{ pad(minute) }}
          </button>
        </div>
      </div>
      <div class="mt-2 flex items-center border-t border-base-200 pt-2">
        <button type="button" class="btn btn-ghost btn-xs" @click="goNow">
          {{ t("time.now") }}
        </button>
      </div>
    </div>
  </Teleport>
</template>

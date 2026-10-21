<script setup lang="ts">
import { isTauri } from "@tauri-apps/api/core";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { todayIso } from "../lib/dates";
import { setLanguage, t, type Language } from "../lib/i18n";
import { isImeEnter } from "../lib/keys";
import { applyTheme, resolveTheme, systemPrefersDark, type AppliedTheme } from "../lib/theme";
import type { CaptureFields } from "../model/types";
import { appVM } from "../viewmodels/appVM";
import { createCaptureDraftVM } from "../viewmodels/captureDraftVM";
import { createCaptureVM } from "../viewmodels/captureVM";
import CaptureChips from "./components/CaptureChips.vue";

const vm = createCaptureVM();
const draft = createCaptureDraftVM(() => ({
  today: todayIso(),
  projects: appVM.state.projects,
  people: appVM.state.people,
}));
const { title, fields, matched } = draft;
watch(
  () => vm.state.draft,
  (raw) => draft.setRaw(raw),
  { immediate: true },
);

const input = ref<HTMLInputElement | null>(null);
const card = ref<HTMLElement | null>(null);
let unlisten: (() => void) | null = null;
let unlistenTheme: (() => void) | null = null;
let unlistenLanguage: (() => void) | null = null;
let blurTimer: ReturnType<typeof setTimeout> | undefined;
let observer: ResizeObserver | null = null;
let lastHeight = 0;

function hide(): void {
  void getCurrentWindow().hide();
}

async function openMain(): Promise<void> {
  const main = await WebviewWindow.getByLabel("main");
  await main?.show();
  hide();
}

async function submit(): Promise<void> {
  await vm.save(title.value, fields.value, hide);
  vm.state.draft = "";
}

function onEnter(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void submit();
}

function onEdit(patch: Partial<CaptureFields>): void {
  draft.edit(patch);
  void nextTick(() => input.value?.focus());
}

function onBlur(): void {
  clearTimeout(blurTimer);
  blurTimer = setTimeout(hide, 150);
}

function onFocus(): void {
  clearTimeout(blurTimer);
}

/** Keep the frameless window exactly as tall as the card, never smaller than the old 96px. */
async function fitWindow(): Promise<void> {
  if (!isTauri()) return;
  await nextTick();
  const height = Math.max(96, Math.ceil((card.value?.getBoundingClientRect().height ?? 0) + 16));
  if (height === lastHeight) return;
  lastHeight = height;
  await getCurrentWindow()
    .setSize(new LogicalSize(560, height))
    .catch(() => {});
}

async function refreshContext(): Promise<void> {
  try {
    await appVM.load();
  } catch {
    // The capture window still works with its current lists.
  }
}

onMounted(async () => {
  await nextTick();
  input.value?.focus();
  observer = new ResizeObserver(() => void fitWindow());
  if (card.value) observer.observe(card.value);
  await fitWindow();
  unlisten = await listen("capture:focus", () => {
    input.value?.focus();
    void refreshContext();
    void fitWindow();
  });
  // A separate document: it gets the theme once now, and again whenever it changes.
  unlistenTheme = await listen<AppliedTheme>("theme:changed", (event) => {
    applyTheme(event.payload);
  });
  unlistenLanguage = await listen<Language>("language:changed", (event) => {
    setLanguage(event.payload);
  });
  await refreshContext();
  applyTheme(resolveTheme(appVM.state.settings?.theme ?? "system", systemPrefersDark()));
  setLanguage(appVM.state.settings?.language ?? "zh");
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
});

onUnmounted(() => {
  observer?.disconnect();
  unlisten?.();
  unlistenTheme?.();
  unlistenLanguage?.();
  window.removeEventListener("blur", onBlur);
  window.removeEventListener("focus", onFocus);
});
</script>

<template>
  <div class="min-h-screen bg-transparent p-2">
    <div ref="card" class="rounded-xl bg-base-100 px-3 py-2.5 shadow-2xl" @keydown.esc="hide">
      <div class="flex items-center gap-2">
        <input
          ref="input"
          v-model="vm.state.draft"
          class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/40"
          :placeholder="t('capture.placeholder')"
          :title="t('capture.syntax')"
          @keydown.enter="onEnter"
          @keydown.esc="hide"
        />
        <span v-if="vm.state.saved" class="shrink-0 text-[11px] text-success">{{
          t("capture.saved")
        }}</span>
        <span v-else class="shrink-0 text-[10.5px] text-base-content/35">{{
          t("capture.hint")
        }}</span>
        <button
          class="shrink-0 text-[10.5px] text-base-content/35 hover:text-base-content/60"
          @mousedown.prevent="openMain"
        >
          {{ t("capture.mainWindow") }}
        </button>
      </div>
      <CaptureChips
        v-if="vm.state.draft.trim()"
        :fields="fields"
        :matched="matched"
        @edit="onEdit"
      />
    </div>
  </div>
</template>

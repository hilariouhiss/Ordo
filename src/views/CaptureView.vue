<script setup lang="ts">
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { nextTick, onMounted, onUnmounted, ref } from "vue";
import { setLanguage, t, type Language } from "../lib/i18n";
import { isImeEnter } from "../lib/keys";
import { applyTheme, resolveTheme, systemPrefersDark, type AppliedTheme } from "../lib/theme";
import { getSettings } from "../model/ipc";
import { createCaptureVM } from "../viewmodels/captureVM";

const vm = createCaptureVM();
const input = ref<HTMLInputElement | null>(null);
let unlisten: (() => void) | null = null;
let unlistenTheme: (() => void) | null = null;
let unlistenLanguage: (() => void) | null = null;
let blurTimer: ReturnType<typeof setTimeout> | undefined;

function hide(): void {
  void getCurrentWindow().hide();
}

async function openMain(): Promise<void> {
  const main = await WebviewWindow.getByLabel("main");
  await main?.show();
  hide();
}

async function submit(): Promise<void> {
  await vm.save(vm.state.draft, hide);
  vm.state.draft = "";
}

function onEnter(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void submit();
}

function onBlur(): void {
  clearTimeout(blurTimer);
  blurTimer = setTimeout(hide, 150);
}

function onFocus(): void {
  clearTimeout(blurTimer);
}

onMounted(async () => {
  await nextTick();
  input.value?.focus();
  unlisten = await listen("capture:focus", () => input.value?.focus());
  // A separate document: it gets the theme once now, and again whenever it changes.
  unlistenTheme = await listen<AppliedTheme>("theme:changed", (event) => {
    applyTheme(event.payload);
  });
  unlistenLanguage = await listen<Language>("language:changed", (event) => {
    setLanguage(event.payload);
  });
  const settings = await getSettings();
  applyTheme(resolveTheme(settings.theme, systemPrefersDark()));
  setLanguage(settings.language);
  window.addEventListener("blur", onBlur);
  window.addEventListener("focus", onFocus);
});

onUnmounted(() => {
  unlisten?.();
  unlistenTheme?.();
  unlistenLanguage?.();
  window.removeEventListener("blur", onBlur);
  window.removeEventListener("focus", onFocus);
});
</script>

<template>
  <div class="min-h-screen bg-transparent p-2">
    <div class="flex items-center gap-2 rounded-xl bg-base-100 px-3 py-2.5 shadow-2xl">
      <input
        ref="input"
        v-model="vm.state.draft"
        class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/40"
        :placeholder="t('capture.placeholder')"
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
  </div>
</template>

<script setup lang="ts">
import { Copy, Minus, Square, X } from "@lucide/vue";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onMounted, onUnmounted, ref } from "vue";
import { t } from "../../lib/i18n";

const win = isTauri() ? getCurrentWindow() : null;
const maximized = ref(false);
let unlisten: (() => void) | undefined;

async function syncMaximized(): Promise<void> {
  if (win) maximized.value = await win.isMaximized();
}

onMounted(async () => {
  if (!win) return;
  await syncMaximized();
  unlisten = await win.onResized(() => void syncMaximized());
});

onUnmounted(() => unlisten?.());

function minimize(): void {
  void win?.minimize();
}

function toggleMaximize(): void {
  void win?.toggleMaximize();
}

function closeWindow(): void {
  void win?.close();
}
</script>

<template>
  <div v-if="win" class="flex h-full">
    <button
      type="button"
      class="grid h-full w-11 place-items-center text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content focus-visible:ring-2 focus-visible:ring-primary/50"
      :aria-label="t('window.minimize')"
      :title="t('window.minimize')"
      @click="minimize"
    >
      <Minus :size="14" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="grid h-full w-11 place-items-center text-base-content/50 transition-colors hover:bg-base-200 hover:text-base-content focus-visible:ring-2 focus-visible:ring-primary/50"
      :aria-label="maximized ? t('window.restore') : t('window.maximize')"
      :title="maximized ? t('window.restore') : t('window.maximize')"
      @click="toggleMaximize"
    >
      <Copy v-if="maximized" :size="13" aria-hidden="true" />
      <Square v-else :size="12" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="grid h-full w-11 place-items-center text-base-content/50 transition-colors hover:bg-error hover:text-error-content focus-visible:ring-2 focus-visible:ring-primary/50"
      :aria-label="t('window.close')"
      :title="t('window.close')"
      @click="closeWindow"
    >
      <X :size="15" aria-hidden="true" />
    </button>
  </div>
</template>

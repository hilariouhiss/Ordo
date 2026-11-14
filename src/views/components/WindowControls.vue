<script setup lang="ts">
import { Copy, Minus, Square, X } from "@lucide/vue";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed } from "vue";
import { t } from "../../lib/i18n";
import { windowModeVM } from "../../viewmodels/windowModeVM";

const win = isTauri() ? getCurrentWindow() : null;
const maximized = computed(() => windowModeVM.state.maximized);

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
  <div v-if="win" class="flex h-full items-center gap-0.5">
    <button
      type="button"
      class="grid size-9 place-items-center rounded-md text-base-content/55 transition-colors hover:bg-base-300/60 hover:text-base-content focus-visible:ring-2 focus-visible:ring-primary/50"
      :aria-label="t('window.minimize')"
      :title="t('window.minimize')"
      @click="minimize"
    >
      <Minus :size="14" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="grid size-9 place-items-center rounded-md text-base-content/55 transition-colors hover:bg-base-300/60 hover:text-base-content focus-visible:ring-2 focus-visible:ring-primary/50"
      :aria-label="maximized ? t('window.restore') : t('window.maximize')"
      :title="maximized ? t('window.restore') : t('window.maximize')"
      @click="toggleMaximize"
    >
      <Copy v-if="maximized" :size="13" aria-hidden="true" />
      <Square v-else :size="12" aria-hidden="true" />
    </button>
    <button
      type="button"
      class="grid size-9 place-items-center rounded-md text-base-content/55 transition-colors hover:bg-error hover:text-error-content focus-visible:ring-2 focus-visible:ring-primary/50"
      :aria-label="t('window.close')"
      :title="t('window.close')"
      @click="closeWindow"
    >
      <X :size="14" aria-hidden="true" />
    </button>
  </div>
</template>

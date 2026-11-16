<script setup lang="ts">
import { Download, RefreshCw, X } from "@lucide/vue";
import { computed } from "vue";
import { t } from "../../lib/i18n";
import { updatesVM } from "../../viewmodels/updatesVM";

const state = updatesVM.state;
const visible = updatesVM.visible;

const message = computed(() => {
  const version = state.version ?? "";
  switch (state.phase) {
    case "downloading":
      return state.percent === null
        ? t("update.downloadingUnknown", { version })
        : t("update.downloading", { version, percent: state.percent });
    case "installing":
      return t("update.installing", { version });
    case "failed":
      return t("update.failed", { error: state.error ?? "" });
    case "ready":
      return t("update.ready", { version });
    default:
      return t("update.available", { version });
  }
});

const icon = computed(() => {
  if (state.phase === "installing") return RefreshCw;
  if (state.phase === "failed") return X;
  return Download;
});
</script>

<template>
  <!-- Bottom-left, non-modal: reports what the app found and asks for one decision. -->
  <div
    v-if="visible"
    role="status"
    aria-live="polite"
    class="fixed bottom-4 left-4 z-30 flex w-80 flex-col gap-2 rounded-xl border border-base-300 bg-base-100 p-3 text-base-content shadow-lg"
  >
    <div class="flex items-start gap-2">
      <component
        :is="icon"
        :size="15"
        class="mt-0.5 shrink-0 text-base-content/60"
        aria-hidden="true"
      />
      <p class="min-w-0 flex-1 text-[12.5px] leading-snug break-words">{{ message }}</p>
      <button
        v-if="state.phase !== 'installing'"
        type="button"
        class="-m-1 shrink-0 rounded-md p-1 text-base-content/40 hover:text-base-content"
        :aria-label="t('update.close')"
        @click="updatesVM.dismiss()"
      >
        <X :size="13" aria-hidden="true" />
      </button>
    </div>
    <div v-if="state.phase === 'downloading'" class="h-1 overflow-hidden rounded-full bg-base-300">
      <i
        class="block h-full rounded-full bg-primary motion-safe:transition-[width] motion-safe:duration-300"
        :style="{ width: state.percent === null ? '30%' : `${state.percent}%` }"
      />
    </div>
    <div
      v-if="state.phase !== 'downloading' && state.phase !== 'installing'"
      class="flex justify-end gap-2"
    >
      <button
        v-if="state.phase !== 'failed'"
        class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
        @click="updatesVM.dismiss()"
      >
        {{ t("update.later") }}
      </button>
      <button
        v-if="state.phase !== 'failed'"
        class="btn btn-xs rounded-md border-0 bg-primary font-normal text-primary-content"
        @click="updatesVM.install()"
      >
        {{ t(state.phase === "ready" ? "update.buttonUpdate" : "update.buttonInstall") }}
      </button>
      <button
        v-else
        class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
        @click="updatesVM.dismiss()"
      >
        {{ t("common.close") }}
      </button>
    </div>
  </div>
</template>

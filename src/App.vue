<script setup lang="ts">
import { Settings } from "@lucide/vue";
import { listen, emitTo } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { onMounted, watch } from "vue";
import { RouterLink, RouterView, useRouter } from "vue-router";
import {
  applyTheme,
  systemPrefersDark,
  systemTheme,
  type AppliedTheme,
  type ThemeWindow,
} from "./lib/theme";
import { appVM } from "./viewmodels/appVM";
import { passVM } from "./viewmodels/passVM";
import { settingsVM } from "./viewmodels/settingsVM";
import { taskSheetVM } from "./viewmodels/taskSheetVM";
import { tasksVM } from "./viewmodels/tasksVM";
import { weekVM } from "./viewmodels/weekVM";
import WindowControls from "./views/components/WindowControls.vue";
import AppDialog from "./views/overlays/AppDialog.vue";
import SettingsModal from "./views/overlays/SettingsModal.vue";

const router = useRouter();

// The tray always lands somewhere clean; a leftover overlay would hide it.
function closeOverlays(): void {
  taskSheetVM.close();
  passVM.close();
  settingsVM.close();
}

function themeWindow(): ThemeWindow | null {
  if (!isTauri()) return null;
  return getCurrentWindow();
}

let themeRun = 0;

// The mini window is a separate document, so it has to be told too.
async function syncTheme(): Promise<void> {
  const run = ++themeRun;
  const pref = appVM.state.settings?.theme;
  const win = themeWindow();
  if (run !== themeRun) return;
  let theme: AppliedTheme;
  if (pref === "light" || pref === "dark") {
    theme = pref;
    // Only an explicit choice pins the native frame; pinning also freezes the webview's media query.
    if (win) await win.setTheme(pref).catch(() => {});
  } else {
    theme = await systemTheme(win, systemPrefersDark());
  }
  if (run !== themeRun) return;
  applyTheme(theme);
  if (isTauri()) void emitTo("capture", "theme:changed", theme);
}

onMounted(async () => {
  await appVM.load();
  void syncTheme();
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => void syncTheme());
  watch(
    () => appVM.state.settings?.theme,
    () => void syncTheme(),
  );
  if (isTauri()) {
    await listen("capture:created", () => {
      void weekVM.load();
      void tasksVM.load();
    });
    await listen("ai:enriched", () => {
      void weekVM.load();
      void tasksVM.load();
    });
    await listen<string>("reminder:open", async (event) => {
      await router.push("/week");
      await taskSheetVM.open(event.payload);
    });
    await listen("nav:week", async () => {
      closeOverlays();
      await router.push("/week");
    });
    await listen("nav:pass", async () => {
      closeOverlays();
      await router.push("/week");
      await passVM.start();
    });
    await listen("open:settings", () => {
      closeOverlays();
      settingsVM.open();
    });
  }
});
</script>

<template>
  <div class="flex h-screen flex-col bg-base-200 text-base-content">
    <header
      data-tauri-drag-region="deep"
      class="flex h-12 shrink-0 items-center gap-4 border-b border-base-300 bg-base-100 pl-6 select-none"
    >
      <span class="text-[15px] font-semibold tracking-tight">ordo</span>
      <nav role="tablist" class="tabs tabs-border tabs-sm">
        <RouterLink to="/week" class="tab" active-class="tab-active">本周</RouterLink>
        <RouterLink to="/tasks" class="tab" active-class="tab-active">任务</RouterLink>
        <RouterLink to="/projects" class="tab" active-class="tab-active">项目</RouterLink>
        <RouterLink to="/categories" class="tab" active-class="tab-active">分类</RouterLink>
        <RouterLink to="/tags" class="tab" active-class="tab-active">标签</RouterLink>
        <RouterLink to="/people" class="tab" active-class="tab-active">人员</RouterLink>
        <RouterLink to="/archive" class="tab" active-class="tab-active">归档</RouterLink>
      </nav>
      <div class="ml-auto flex h-full items-center gap-2">
        <span v-if="!appVM.state.ready" class="loading loading-spinner loading-xs"></span>
        <button
          class="grid size-8 place-items-center rounded-lg text-base-content/45 hover:bg-base-200 hover:text-base-content"
          aria-label="设置"
          @click="settingsVM.open()"
        >
          <Settings :size="16" aria-hidden="true" />
        </button>
        <WindowControls />
      </div>
    </header>
    <main class="min-h-0 flex-1 overflow-y-auto">
      <div class="mx-auto max-w-[980px] px-6 py-5">
        <RouterView />
      </div>
    </main>
    <SettingsModal v-if="settingsVM.state.open" />
    <AppDialog />
  </div>
</template>

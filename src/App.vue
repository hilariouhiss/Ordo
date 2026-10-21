<script setup lang="ts">
import { Settings } from "@lucide/vue";
import { listen, emitTo } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion-v";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { pageDirection, pageMotion, springSnappy } from "./lib/motion";
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

const navItems = [
  { name: "week", to: "/week", label: "本周" },
  { name: "tasks", to: "/tasks", label: "任务" },
  { name: "projects", to: "/projects", label: "项目" },
  { name: "categories", to: "/categories", label: "分类" },
  { name: "tags", to: "/tags", label: "标签" },
  { name: "people", to: "/people", label: "人员" },
  { name: "archive", to: "/archive", label: "归档" },
] as const;

const router = useRouter();
const route = useRoute();
const direction = ref<1 | -1>(1);
const pageMotions = computed(() => pageMotion(direction.value));

function routeName(name: unknown): string | null {
  return typeof name === "string" ? name : null;
}

function isActive(name: string): boolean {
  return route.name === name || (name === "projects" && route.name === "project");
}

watch(
  () => route.name,
  (to, from) => {
    direction.value = pageDirection(routeName(from), routeName(to));
  },
);

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
  <MotionConfig reducedMotion="user">
    <div class="flex h-screen flex-col bg-base-200 text-base-content">
      <header
        data-tauri-drag-region="deep"
        class="flex h-12 shrink-0 items-center gap-4 border-b border-base-300 bg-base-100 pl-6 select-none"
      >
        <span class="text-[15px] font-semibold tracking-tight">ordo</span>
        <LayoutGroup>
          <nav role="tablist" class="app-nav tabs tabs-border tabs-sm">
            <RouterLink
              v-for="item in navItems"
              :key="item.name"
              :to="item.to"
              class="tab"
              active-class="tab-active"
            >
              {{ item.label }}
              <motion.span
                v-if="isActive(item.name)"
                layout-id="nav-underline"
                aria-hidden="true"
                class="absolute inset-x-3 bottom-0 h-[3px] rounded-full bg-primary"
                :initial="false"
                :transition="springSnappy"
              />
            </RouterLink>
          </nav>
        </LayoutGroup>
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
          <RouterView v-slot="{ Component }">
            <AnimatePresence mode="wait" :initial="false">
              <motion.div :key="route.fullPath" v-bind="pageMotions">
                <component :is="Component" />
              </motion.div>
            </AnimatePresence>
          </RouterView>
        </div>
      </main>
      <AnimatePresence>
        <SettingsModal v-if="settingsVM.state.open" />
      </AnimatePresence>
      <AppDialog />
    </div>
  </MotionConfig>
</template>

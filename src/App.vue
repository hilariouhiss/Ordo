<script setup lang="ts">
import { PanelRight, Settings } from "@lucide/vue";
import { listen, emitTo } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion-v";
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { askNotice, closeDialog, dialogRequest } from "./lib/dialog";
import { errorText, setLanguage, t } from "./lib/i18n";
import { pageDirection, pageMotion, springSnappy } from "./lib/motion";
import {
  applyTheme,
  systemPrefersDark,
  systemTheme,
  type AppliedTheme,
  type ThemeWindow,
} from "./lib/theme";
import type { Task } from "./model/types";
import { appVM } from "./viewmodels/appVM";
import { deskVM } from "./viewmodels/deskVM";
import { warnExclusiveConflict } from "./viewmodels/planning";
import { passVM } from "./viewmodels/passVM";
import { settingsVM } from "./viewmodels/settingsVM";
import { taskSheetVM } from "./viewmodels/taskSheetVM";
import { tasksVM } from "./viewmodels/tasksVM";
import { weekVM } from "./viewmodels/weekVM";
import WindowControls from "./views/components/WindowControls.vue";
import AppDialog from "./views/overlays/AppDialog.vue";
import SettingsModal from "./views/overlays/SettingsModal.vue";

const navItems = computed(
  () =>
    [
      { name: "week", to: "/week", label: t("nav.week") },
      { name: "tasks", to: "/tasks", label: t("nav.tasks") },
      { name: "projects", to: "/projects", label: t("nav.projects") },
      { name: "categories", to: "/categories", label: t("nav.categories") },
      { name: "tags", to: "/tags", label: t("nav.tags") },
      { name: "people", to: "/people", label: t("nav.people") },
      { name: "archive", to: "/archive", label: t("nav.archive") },
    ] as const,
);

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

watch(
  () => appVM.state.settings?.language,
  (lang) => {
    if (lang !== "zh" && lang !== "en") return;
    setLanguage(lang);
    if (isTauri()) {
      void emitTo("capture", "language:changed", lang);
      void emitTo("desk", "language:changed", lang);
    }
  },
  { immediate: true },
);

watch(
  () => appVM.state.settings?.deskControls,
  (on) => {
    if (isTauri()) void emitTo("desk", "desk:controls", !!on);
  },
);

/** Brings the main window forward and lands on the requested task. */
async function showTask(id: string): Promise<void> {
  if (isTauri()) {
    const win = getCurrentWindow();
    await win.unminimize().catch(() => {});
    await win.show().catch(() => {});
    await win.setFocus().catch(() => {});
  }
  await router.push("/week");
  await taskSheetVM.open(id);
}

async function toggleDesk(): Promise<void> {
  try {
    const enabled = await deskVM.toggleEnabled();
    // Turning the widget on hands the desktop over to it; the tray brings this window back.
    if (enabled && isTauri())
      void getCurrentWindow()
        .hide()
        .catch(() => {});
  } catch (e) {
    void askNotice(t("common.actionFailed"), errorText(e));
  }
}

// The tray always lands somewhere clean; a leftover overlay would hide it.
function closeOverlays(): void {
  // An exclusive-time notice waits for the user; it is not an overlay they opened.
  if (dialogRequest.value?.kind !== "notice") closeDialog(null);
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
  if (isTauri()) {
    void emitTo("capture", "theme:changed", theme);
    void emitTo("desk", "theme:changed", theme);
  }
}

/** Created hidden so the first frame the user sees is painted, themed and resolved. */
function revealWindow(): void {
  if (!isTauri()) return;
  const win = getCurrentWindow();
  void win
    .show()
    .then(() => win.setFocus())
    .catch(() => {});
}

onMounted(async () => {
  try {
    await appVM.load();
  } catch {
    // A failed bootstrap still shows the shell; the tray and shortcuts keep working.
  }
  revealWindow();
  void syncTheme();
  window
    .matchMedia("(prefers-color-scheme: dark)")
    .addEventListener("change", () => void syncTheme());
  watch(
    () => appVM.state.settings?.theme,
    () => void syncTheme(),
  );
  if (isTauri()) {
    await listen<Task>("capture:created", (event) => {
      void weekVM
        .load()
        .then(() => warnExclusiveConflict(event.payload, weekVM.state.tasks))
        .catch(() => {});
      void tasksVM.load();
    });
    await listen("ai:enriched", () => {
      void appVM.load();
      void weekVM.load();
      void tasksVM.load();
    });
    await listen<string>("reminder:open", (event) => {
      void showTask(event.payload);
    });
    await listen<boolean>("desk:changed", (event) => {
      if (appVM.state.settings) appVM.state.settings.deskEnabled = event.payload;
    });
    await listen<string>("desk:open-task", (event) => {
      void showTask(event.payload);
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
    <div
      class="flex h-screen flex-col bg-base-200 text-base-content"
      @dragover.prevent
      @drop.prevent
    >
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
            class="grid size-8 place-items-center rounded-lg"
            :class="
              appVM.state.settings?.deskEnabled
                ? 'bg-primary/10 text-primary'
                : 'text-base-content/45 hover:bg-base-200 hover:text-base-content'
            "
            :aria-label="t('desk.toggle')"
            :title="t('desk.toggle')"
            :aria-pressed="!!appVM.state.settings?.deskEnabled"
            @click="toggleDesk"
          >
            <PanelRight :size="16" aria-hidden="true" />
          </button>
          <button
            class="grid size-8 place-items-center rounded-lg text-base-content/45 hover:bg-base-200 hover:text-base-content"
            :aria-label="t('app.settings')"
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

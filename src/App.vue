<script setup lang="ts">
import { PanelRight, Search, Settings } from "@lucide/vue";
import { listen, emitTo } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, LayoutGroup, MotionConfig, motion } from "motion-v";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { askNotice, dialogRequest } from "./lib/dialog";
import { errorText, setLanguage, t } from "./lib/i18n";
import { createShortcut, isEditableTarget, searchShortcut, undoShortcut } from "./lib/keys";
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
import { projectsVM } from "./viewmodels/projectsVM";
import { quickCreateVM } from "./viewmodels/quickCreateVM";
import { searchVM } from "./viewmodels/searchVM";
import { settingsVM } from "./viewmodels/settingsVM";
import { taskSheetVM } from "./viewmodels/taskSheetVM";
import { tasksVM } from "./viewmodels/tasksVM";
import { templatesVM } from "./viewmodels/templatesVM";
import { undoVM } from "./viewmodels/undoVM";
import { weekVM } from "./viewmodels/weekVM";
import { closeOverlays, windowModeVM } from "./viewmodels/windowModeVM";
import UndoToast from "./views/components/UndoToast.vue";
import WindowControls from "./views/components/WindowControls.vue";
import DeskView from "./views/DeskView.vue";
import AppDialog from "./views/overlays/AppDialog.vue";
import QuickCreate from "./views/overlays/QuickCreate.vue";
import SearchPalette from "./views/overlays/SearchPalette.vue";
import SettingsModal from "./views/overlays/SettingsModal.vue";

const navItems = computed(
  () =>
    [
      { name: "week", to: "/week", label: t("nav.week") },
      { name: "tasks", to: "/tasks", label: t("nav.tasks") },
      { name: "templates", to: "/templates", label: t("nav.templates") },
      { name: "projects", to: "/projects", label: t("nav.projects") },
      { name: "categories", to: "/categories", label: t("nav.categories") },
      { name: "tags", to: "/tags", label: t("nav.tags") },
      { name: "people", to: "/people", label: t("nav.people") },
      { name: "stats", to: "/stats", label: t("nav.stats") },
      { name: "archive", to: "/archive", label: t("nav.archive") },
    ] as const,
);

const router = useRouter();
const route = useRoute();
/** The gantt week page fills the window, so the table has no dead space under it. */
const ganttWeek = computed(
  () => route.name === "week" && appVM.state.settings?.weekView === "gantt",
);
const direction = ref<1 | -1>(1);
const pageMotions = computed(() => pageMotion(direction.value));
/** The surface the window morph scales; windowModeVM writes its morph styles directly. */
const appSurface = ref<HTMLElement | null>(null);
/** The widget layer holds the card; the exit keeps it on screen while the window jumps. */
const widgetLayer = ref<HTMLElement | null>(null);
watch(widgetLayer, (el) => windowModeVM.attachWidgetLayer(el));

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
    }
  },
  { immediate: true },
);

/** Brings the main window forward and lands on the requested task. */
async function showTask(id: string): Promise<void> {
  await windowModeVM.ensureFull();
  if (isTauri()) {
    const win = getCurrentWindow();
    await win.unminimize().catch(() => {});
    await win.show().catch(() => {});
    await win.setFocus().catch(() => {});
  }
  await router.push("/week");
  await taskSheetVM.open(id);
}

async function enterWidget(): Promise<void> {
  try {
    await windowModeVM.enterWidget();
  } catch (e) {
    void askNotice(t("common.actionFailed"), errorText(e));
  }
}

async function backToMain(): Promise<void> {
  try {
    await windowModeVM.enterFull();
  } catch (e) {
    void askNotice(t("common.actionFailed"), errorText(e));
  }
}

async function openFromWidget(id: string): Promise<void> {
  await backToMain();
  await router.push("/week");
  await taskSheetVM.open(id);
}

function onCollapseChange(collapsed: boolean): void {
  windowModeVM.setCollapsed(collapsed);
}

function overlayOpen(): boolean {
  return (
    !!dialogRequest.value ||
    !!searchVM.state.open ||
    !!quickCreateVM.state.mode ||
    !!taskSheetVM.state.openId ||
    settingsVM.state.open ||
    passVM.state.open ||
    projectsVM.state.settingsFor !== null ||
    templatesVM.state.ruleSheet !== null ||
    templatesVM.state.templateSheet !== null
  );
}

function onQuickCreateKey(event: KeyboardEvent): void {
  const target = createShortcut(event);
  if (!target) return;
  event.preventDefault();
  if (!appVM.state.ready || windowModeVM.state.phase !== "idle" || overlayOpen()) return;
  if (target === "task") quickCreateVM.openTask();
  else quickCreateVM.openProject();
}

function openSearch(): void {
  if (!appVM.state.ready || windowModeVM.state.phase !== "idle" || overlayOpen()) return;
  searchVM.open();
}

function onSearchKey(event: KeyboardEvent): void {
  if (!searchShortcut(event)) return;
  event.preventDefault();
  if (searchVM.state.open) {
    searchVM.close();
    return;
  }
  if (!appVM.state.ready || windowModeVM.state.phase !== "idle" || overlayOpen()) return;
  searchVM.open();
}

function onUndoKey(event: KeyboardEvent): void {
  if (!undoShortcut(event) || isEditableTarget(event.target)) return;
  if (overlayOpen() || !undoVM.state.entry) return;
  event.preventDefault();
  void undoVM.undo();
}

// The widget's quick actions do not update the hidden main views; refresh on the way back.
watch(
  () => windowModeVM.state.mode,
  (mode) => {
    if (mode !== "full") return;
    void weekVM.load();
    void tasksVM.load();
  },
);

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
  window.addEventListener("keydown", onQuickCreateKey);
  window.addEventListener("keydown", onSearchKey);
  window.addEventListener("keydown", onUndoKey);
  windowModeVM.attachSurface(appSurface.value);
  try {
    await appVM.load();
  } catch {
    // A failed bootstrap still shows the shell; the tray and shortcuts keep working.
  }
  try {
    await windowModeVM.init();
  } catch {
    // Starting in the full window still leaves the tray and shortcuts working.
  }
  await nextTick();
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
    await listen("capture:created", () => {
      void weekVM.load().catch(() => {});
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
    await listen("window:open", () => {
      void windowModeVM.ensureFull();
    });
    await listen<boolean>("widget:set", (event) => {
      void windowModeVM.setWidget(event.payload);
    });
    await listen("nav:week", async () => {
      await windowModeVM.ensureFull();
      closeOverlays();
      await router.push("/week");
    });
    await listen("nav:pass", async () => {
      await windowModeVM.ensureFull();
      closeOverlays();
      await router.push("/week");
      await passVM.start();
    });
    await listen("open:settings", async () => {
      await windowModeVM.ensureFull();
      closeOverlays();
      settingsVM.open();
    });
  }
});

onUnmounted(() => {
  window.removeEventListener("keydown", onQuickCreateKey);
  window.removeEventListener("keydown", onSearchKey);
  window.removeEventListener("keydown", onUndoKey);
  windowModeVM.attachSurface(null);
  windowModeVM.attachWidgetLayer(null);
});
</script>

<template>
  <MotionConfig reducedMotion="user">
    <div
      class="relative h-screen overflow-hidden"
      :style="{ '--window-radius': windowModeVM.state.maximized ? '0px' : '8px' }"
    >
      <div
        ref="appSurface"
        v-show="windowModeVM.state.appMounted"
        class="app-surface h-full overflow-hidden transition-opacity duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        :class="
          windowModeVM.state.appOpacity === 0 ? 'pointer-events-none opacity-0' : 'opacity-100'
        "
      >
        <div
          class="flex h-full flex-col bg-base-200 text-base-content"
          @dragover.prevent
          @drop.prevent
        >
          <header
            data-tauri-drag-region="deep"
            class="flex h-12 shrink-0 items-center gap-4 border-b border-base-300 bg-base-100 pl-6 select-none"
          >
            <span class="text-[15px] font-semibold tracking-tight">Ordo</span>
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
                :aria-label="t('search.openAria')"
                :title="t('search.openAria')"
                :disabled="windowModeVM.state.phase !== 'idle'"
                @click="openSearch"
              >
                <Search :size="16" aria-hidden="true" />
              </button>
              <button
                class="grid size-8 place-items-center rounded-lg disabled:opacity-50"
                :class="
                  appVM.state.settings?.deskEnabled
                    ? 'bg-primary/10 text-primary'
                    : 'text-base-content/45 hover:bg-base-200 hover:text-base-content'
                "
                :aria-label="t('desk.toggle')"
                :title="t('desk.toggle')"
                :aria-pressed="!!appVM.state.settings?.deskEnabled"
                :disabled="windowModeVM.state.phase !== 'idle'"
                @click="enterWidget"
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
            <div
              class="mx-auto max-w-[980px] px-6 py-5"
              :class="{ 'flex min-h-full flex-col': ganttWeek }"
            >
              <RouterView v-slot="{ Component }">
                <AnimatePresence mode="wait" :initial="false">
                  <motion.div
                    :key="route.fullPath"
                    v-bind="pageMotions"
                    :class="{ 'flex grow flex-col': ganttWeek }"
                  >
                    <component :is="Component" />
                  </motion.div>
                </AnimatePresence>
              </RouterView>
            </div>
          </main>
          <AnimatePresence>
            <SettingsModal v-if="settingsVM.state.open" />
          </AnimatePresence>
        </div>
      </div>
      <div
        ref="widgetLayer"
        v-if="windowModeVM.state.widgetMounted"
        class="fixed inset-0 z-40 transition-opacity duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        :class="
          windowModeVM.state.widgetOpacity === 0 ? 'pointer-events-none opacity-0' : 'opacity-100'
        "
      >
        <DeskView
          :active="windowModeVM.state.widgetActive"
          @open-task="openFromWidget"
          @back="backToMain"
          @collapse-change="onCollapseChange"
        />
      </div>
      <div v-if="windowModeVM.state.phase !== 'idle'" class="fixed inset-0 z-50"></div>
      <QuickCreate />
      <AppDialog />
      <SearchPalette />
      <UndoToast />
    </div>
  </MotionConfig>
</template>

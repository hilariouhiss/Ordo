<script setup lang="ts">
import {
  Archive,
  Briefcase,
  Building,
  CalendarDays,
  ChartColumn,
  FolderKanban,
  House,
  ListChecks,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRight,
  Repeat2,
  Search,
  Settings,
  Shapes,
  Sun,
  Tags,
  Users,
} from "@lucide/vue";
import { listen, emitTo } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AnimatePresence, MotionConfig } from "motion-v";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { askNotice, dialogRequest } from "./lib/dialog";
import { errorText, setLanguage, t } from "./lib/i18n";
import { createShortcut, isEditableTarget, searchShortcut, undoShortcut } from "./lib/keys";
import {
  applyTheme,
  systemPrefersDark,
  systemTheme,
  themeName,
  type AppliedTheme,
  type ThemeWindow,
} from "./lib/theme";
import type { Mode } from "./model/types";
import { appVM } from "./viewmodels/appVM";
import { archiveVM } from "./viewmodels/archiveVM";
import { passVM } from "./viewmodels/passVM";
import { pageHeaderState } from "./viewmodels/pageHeaderVM";
import { overduePromptVM } from "./viewmodels/overduePromptVM";
import { projectsVM } from "./viewmodels/projectsVM";
import { quickCreateVM } from "./viewmodels/quickCreateVM";
import { searchVM } from "./viewmodels/searchVM";
import { settingsVM } from "./viewmodels/settingsVM";
import { statsVM } from "./viewmodels/statsVM";
import { taskSheetVM } from "./viewmodels/taskSheetVM";
import { tasksVM } from "./viewmodels/tasksVM";
import { templatesVM } from "./viewmodels/templatesVM";
import { undoVM } from "./viewmodels/undoVM";
import { updatesVM } from "./viewmodels/updatesVM";
import { weekVM } from "./viewmodels/weekVM";
import { closeOverlays, windowModeVM } from "./viewmodels/windowModeVM";
import UndoToast from "./views/components/UndoToast.vue";
import UpdateCard from "./views/components/UpdateCard.vue";
import WindowControls from "./views/components/WindowControls.vue";
import DeskView from "./views/DeskView.vue";
import AppDialog from "./views/overlays/AppDialog.vue";
import QuickCreate from "./views/overlays/QuickCreate.vue";
import SearchPalette from "./views/overlays/SearchPalette.vue";
import SettingsModal from "./views/overlays/SettingsModal.vue";

const primaryNav = computed(
  () =>
    [
      { name: "week", to: "/week", label: t("nav.week"), icon: CalendarDays },
      { name: "tasks", to: "/tasks", label: t("nav.tasks"), icon: ListChecks },
      { name: "projects", to: "/projects", label: t("nav.projects"), icon: FolderKanban },
      { name: "templates", to: "/templates", label: t("nav.templates"), icon: Repeat2 },
      { name: "stats", to: "/stats", label: t("nav.stats"), icon: ChartColumn },
      { name: "archive", to: "/archive", label: t("nav.archive"), icon: Archive },
    ] as const,
);
/** The shared vocabulary: real pages, but rarely opened, so they sit below a label. */
const referenceNav = computed(
  () =>
    [
      { name: "clients", to: "/clients", label: t("nav.clients"), icon: Building },
      { name: "categories", to: "/categories", label: t("nav.categories"), icon: Shapes },
      { name: "tags", to: "/tags", label: t("nav.tags"), icon: Tags },
      { name: "people", to: "/people", label: t("nav.people"), icon: Users },
    ] as const,
);

/** What the page painted with right now, which is what the theme button shows. */
const appliedTheme = ref<AppliedTheme>("light");
/** What the lists are filtered by. */
const mode = computed<Mode>(() => appVM.state.settings?.mode ?? "work");
const modeIcon = computed(() => (mode.value === "personal" ? House : Briefcase));
const modeLabel = computed(() => t(mode.value === "personal" ? "mode.personal" : "mode.work"));
const deskOn = computed(() => !!appVM.state.settings?.deskEnabled);

/** How wide the sidebar is belongs to the window, not the ledger: localStorage, not Rust settings. */
const SIDEBAR_KEY = "ordo.sidebar";
const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_KEY) === "collapsed");
watch(sidebarCollapsed, (collapsed) =>
  localStorage.setItem(SIDEBAR_KEY, collapsed ? "collapsed" : "expanded"),
);
function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value;
}

function cycleMode(): void {
  if (!appVM.state.ready || windowModeVM.state.phase !== "idle") return;
  void settingsVM.switchMode(mode.value === "personal" ? "work" : "personal");
}
const themeIcon = computed(() => (appliedTheme.value === "dark" ? Moon : Sun));
const themeLabel = computed(() =>
  t(appliedTheme.value === "dark" ? "settings.themeDark" : "settings.themeLight"),
);

/** The button only flips the two explicit themes; "follow the system" lives in settings. */
async function cycleTheme(): Promise<void> {
  const ok = await settingsVM.save({ theme: appliedTheme.value === "dark" ? "light" : "dark" });
  if (!ok) void askNotice(t("common.actionFailed"), errorText(settingsVM.state.error));
}

const router = useRouter();
const route = useRoute();
/** The gantt week page fills the window, so the table has no dead space under it. */
const ganttWeek = computed(
  () => route.name === "week" && appVM.state.settings?.weekView === "gantt",
);
/** The surface the window morph scales; windowModeVM writes its morph styles directly. */
const appSurface = ref<HTMLElement | null>(null);
/** The widget layer holds the card; the exit keeps it on screen while the window jumps. */
const widgetLayer = ref<HTMLElement | null>(null);
watch(widgetLayer, (el) => windowModeVM.attachWidgetLayer(el));

/** A page sets its own title row; until it does, the route names the page. */
const fallbackTitle = computed(() => {
  if (route.name === "project") return t("nav.projects");
  const item = [...primaryNav.value, ...referenceNav.value].find((one) => one.name === route.name);
  return item?.label ?? "Ordo";
});
const headerTitle = computed(() => pageHeaderState.title || fallbackTitle.value);

function runHeaderAction(): void {
  pageHeaderState.action?.();
}

function isActive(name: string): boolean {
  return route.name === name || (name === "projects" && route.name === "project");
}

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
    weekVM.reload();
    tasksVM.reload();
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
  const name = themeName(theme, appVM.state.settings?.mode ?? "work");
  applyTheme(name);
  appliedTheme.value = theme;
  if (isTauri()) {
    void emitTo("capture", "theme:changed", name);
  }
}

/** Both a manual switch and the schedule land here; every mode-filtered list reloads. */
function refreshAfterModeChange(): void {
  void appVM.load().catch(() => {});
  weekVM.reload();
  tasksVM.reload();
  projectsVM.load().catch(() => {});
  templatesVM.load().catch(() => {});
  archiveVM.load().catch(() => {});
  void statsVM.refresh();
  if (searchVM.state.open) void searchVM.run();
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

let stopUpdates: (() => void) | null = null;

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
  watch(mode, (next, before) => {
    // The first load only seeds the value; a real switch repaints and reloads.
    if (!before || before === next) return;
    void syncTheme();
    refreshAfterModeChange();
    if (route.name === "project") {
      projectsVM.closeSettings();
      void router.push("/projects");
    }
  });
  if (isTauri()) {
    await listen("capture:created", () => {
      weekVM.reload();
      tasksVM.reload();
      // The mini window can create a project with `#name`; its id has to reach the
      // pickers here too, not just the task lists.
      void appVM.load().catch(() => {});
    });
    await listen("ai:enriched", () => {
      void appVM.load();
      weekVM.reload();
      tasksVM.reload();
    });
    await listen("tasks:changed", () => {
      weekVM.reload();
      tasksVM.reload();
    });
    await listen("overdue:check", () => {
      void overduePromptVM.check();
    });
    await listen<Mode>("mode:changed", (event) => {
      const settings = appVM.state.settings;
      if (settings) settings.mode = event.payload;
      else void appVM.load().catch(() => {});
    });
    await listen<string>("reminder:open", (event) => {
      void showTask(event.payload);
    });
    await listen<string>("reminder:open-project", async (event) => {
      await windowModeVM.ensureFull();
      closeOverlays();
      await router.push(`/projects/${event.payload}`);
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
  // A schedule switch can land while this window boots and emit before the listener
  // above exists; one more read catches it without waiting for the next point.
  void appVM.load().catch(() => {});
  overduePromptVM.startup();
  stopUpdates = updatesVM.start();
});

onUnmounted(() => {
  window.removeEventListener("keydown", onQuickCreateKey);
  window.removeEventListener("keydown", onSearchKey);
  window.removeEventListener("keydown", onUndoKey);
  windowModeVM.attachSurface(null);
  windowModeVM.attachWidgetLayer(null);
  stopUpdates?.();
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
        <div class="flex h-full bg-base-200 text-base-content" @dragover.prevent @drop.prevent>
          <aside
            class="flex shrink-0 flex-col border-r border-base-300 pb-2.5 transition-[width] duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
            :class="sidebarCollapsed ? 'w-14' : 'w-56'"
          >
            <div
              class="flex h-14 items-center"
              :class="sidebarCollapsed ? 'justify-center' : 'gap-2.5 px-4.5'"
              data-tauri-drag-region
            >
              <img src="/favicon.svg" alt="" class="size-7 shrink-0" aria-hidden="true" />
              <span v-if="!sidebarCollapsed" class="text-[15px] font-semibold tracking-[0.01em]"
                >Ordo</span
              >
            </div>
            <nav class="mt-2 flex flex-col gap-0.5 px-3" :aria-label="t('nav.mainAria')">
              <RouterLink
                v-for="item in primaryNav"
                :key="item.name"
                :to="item.to"
                class="flex h-8 items-center gap-2.5 rounded-md text-[13.5px]"
                :class="[
                  isActive(item.name)
                    ? 'bg-base-300 font-medium text-base-content'
                    : 'text-base-content/70 hover:bg-base-300/60 hover:text-base-content',
                  sidebarCollapsed ? 'justify-center px-0' : 'px-2.5',
                ]"
                :title="sidebarCollapsed ? item.label : undefined"
                :aria-label="sidebarCollapsed ? item.label : undefined"
              >
                <component
                  :is="item.icon"
                  :size="16"
                  :stroke-width="1.6"
                  aria-hidden="true"
                  :class="isActive(item.name) ? 'text-base-content' : 'text-base-content/55'"
                />
                <span v-if="!sidebarCollapsed">{{ item.label }}</span>
              </RouterLink>
              <div
                v-if="!sidebarCollapsed"
                class="mt-5 px-2.5 pb-1.5 text-[11.5px] text-base-content/55"
              >
                {{ t("nav.reference") }}
              </div>
              <div v-else class="mx-2 my-3 border-t border-base-300" aria-hidden="true"></div>
              <RouterLink
                v-for="item in referenceNav"
                :key="item.name"
                :to="item.to"
                class="flex h-8 items-center gap-2.5 rounded-md text-[13.5px]"
                :class="[
                  isActive(item.name)
                    ? 'bg-base-300 font-medium text-base-content'
                    : 'text-base-content/70 hover:bg-base-300/60 hover:text-base-content',
                  sidebarCollapsed ? 'justify-center px-0' : 'px-2.5',
                ]"
                :title="sidebarCollapsed ? item.label : undefined"
                :aria-label="sidebarCollapsed ? item.label : undefined"
              >
                <component
                  :is="item.icon"
                  :size="16"
                  :stroke-width="1.6"
                  aria-hidden="true"
                  :class="isActive(item.name) ? 'text-base-content' : 'text-base-content/55'"
                />
                <span v-if="!sidebarCollapsed">{{ item.label }}</span>
              </RouterLink>
            </nav>
            <div class="mt-auto flex flex-col gap-0.5 border-t border-base-300 px-3 pt-2.5">
              <button
                type="button"
                class="flex h-[34px] items-center gap-2.5 rounded-md text-[13px] text-base-content/70 hover:bg-base-300/60 hover:text-base-content disabled:opacity-50"
                :class="sidebarCollapsed ? 'justify-center px-0' : 'px-2.5'"
                :disabled="!appVM.state.ready || windowModeVM.state.phase !== 'idle'"
                :title="t('app.modeAria', { mode: modeLabel })"
                :aria-label="t('mode.rowLabel', { mode: modeLabel })"
                @click="cycleMode"
              >
                <component
                  :is="modeIcon"
                  :size="15"
                  :stroke-width="1.6"
                  aria-hidden="true"
                  class="text-base-content/55"
                />
                <span v-if="!sidebarCollapsed" class="truncate">{{
                  t("mode.rowLabel", { mode: modeLabel })
                }}</span>
                <span
                  v-if="!sidebarCollapsed"
                  class="ml-auto shrink-0 text-[11.5px] text-base-content/50"
                  >{{ t("mode.switchLabel") }}</span
                >
              </button>
              <button
                type="button"
                class="flex h-8 items-center gap-2.5 rounded-md text-[13px] disabled:opacity-50"
                :class="[
                  deskOn
                    ? 'bg-primary/10 text-primary'
                    : 'text-base-content/70 hover:bg-base-300/60 hover:text-base-content',
                  sidebarCollapsed ? 'justify-center px-0' : 'px-2.5',
                ]"
                :aria-pressed="deskOn"
                :aria-label="t('desk.rowLabel')"
                :title="t('desk.toggle')"
                :disabled="windowModeVM.state.phase !== 'idle'"
                @click="enterWidget"
              >
                <PanelRight
                  :size="15"
                  :stroke-width="1.6"
                  aria-hidden="true"
                  :class="deskOn ? 'text-primary' : 'text-base-content/55'"
                />
                <span v-if="!sidebarCollapsed" class="truncate">{{ t("desk.rowLabel") }}</span>
              </button>
              <button
                type="button"
                class="flex h-8 items-center gap-2.5 rounded-md text-[13px] text-base-content/70 hover:bg-base-300/60 hover:text-base-content"
                :class="sidebarCollapsed ? 'justify-center px-0' : 'px-2.5'"
                :aria-label="t('app.settings')"
                :title="t('app.settings')"
                @click="settingsVM.open()"
              >
                <Settings
                  :size="15"
                  :stroke-width="1.6"
                  aria-hidden="true"
                  class="text-base-content/55"
                />
                <span v-if="!sidebarCollapsed">{{ t("app.settings") }}</span>
              </button>
              <button
                type="button"
                class="flex h-8 items-center gap-2.5 rounded-md text-[13px] text-base-content/70 hover:bg-base-300/60 hover:text-base-content"
                :class="sidebarCollapsed ? 'justify-center px-0' : 'px-2.5'"
                :aria-label="sidebarCollapsed ? t('nav.expand') : t('nav.collapse')"
                :title="sidebarCollapsed ? t('nav.expand') : t('nav.collapse')"
                @click="toggleSidebar"
              >
                <component
                  :is="sidebarCollapsed ? PanelLeftOpen : PanelLeftClose"
                  :size="15"
                  :stroke-width="1.6"
                  aria-hidden="true"
                  class="text-base-content/55"
                />
                <span v-if="!sidebarCollapsed">{{ t("nav.collapse") }}</span>
              </button>
            </div>
          </aside>

          <div class="flex min-w-0 flex-1 flex-col">
            <header
              data-tauri-drag-region="deep"
              class="flex h-14 shrink-0 items-center gap-3 pl-7 select-none"
            >
              <div class="flex min-w-0 items-center gap-3.5">
                <h1
                  class="shrink-0 text-[20px] font-semibold tracking-[-0.015em] whitespace-nowrap"
                >
                  {{ headerTitle }}
                </h1>
                <span
                  v-if="pageHeaderState.context"
                  class="min-w-0 truncate text-[13px] text-base-content/70"
                  >{{ pageHeaderState.context }}</span
                >
                <span
                  v-if="pageHeaderState.warning"
                  class="flex shrink-0 items-center gap-2 text-[13px] font-medium text-error"
                >
                  <span
                    v-if="pageHeaderState.context"
                    class="font-normal text-base-content/40"
                    aria-hidden="true"
                    >·</span
                  >
                  {{ pageHeaderState.warning }}
                </span>
                <button
                  v-if="pageHeaderState.action"
                  type="button"
                  class="btn-ink ml-1"
                  @click="runHeaderAction"
                >
                  {{ pageHeaderState.actionLabel }}
                  <span v-if="pageHeaderState.actionCount !== null" class="n">{{
                    pageHeaderState.actionCount
                  }}</span>
                </button>
              </div>
              <div class="ml-auto flex h-full items-center gap-1 pr-1">
                <span v-if="!appVM.state.ready" class="loading loading-spinner loading-xs"></span>
                <button
                  type="button"
                  class="grid size-8 place-items-center rounded-md text-base-content/60 hover:bg-base-300/60 hover:text-base-content disabled:opacity-50"
                  :aria-label="t('search.openAria')"
                  :title="t('search.openAria')"
                  :disabled="windowModeVM.state.phase !== 'idle'"
                  @click="openSearch"
                >
                  <Search :size="16" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="grid size-8 place-items-center rounded-md text-base-content/60 hover:bg-base-300/60 hover:text-base-content"
                  :aria-label="t('app.themeAria', { mode: themeLabel })"
                  :title="t('app.themeAria', { mode: themeLabel })"
                  @click="cycleTheme"
                >
                  <component :is="themeIcon" :size="16" aria-hidden="true" />
                </button>
                <WindowControls />
              </div>
            </header>
            <main class="min-h-0 flex-1 overflow-y-auto">
              <div
                class="max-w-[1600px] px-7 pt-0.5 pb-9"
                :class="{ 'flex min-h-full flex-col': ganttWeek }"
              >
                <RouterView v-slot="{ Component }">
                  <component :is="Component" :class="{ 'flex grow flex-col': ganttWeek }" />
                </RouterView>
              </div>
            </main>
          </div>
        </div>
        <AnimatePresence>
          <SettingsModal v-if="settingsVM.state.open" />
        </AnimatePresence>
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
      <UpdateCard />
      <UndoToast />
    </div>
  </MotionConfig>
</template>

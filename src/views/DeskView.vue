<script setup lang="ts">
import { Pause, Pin, Play, X } from "@lucide/vue";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { emitTo, listen } from "@tauri-apps/api/event";
import {
  availableMonitors,
  currentMonitor,
  getCurrentWindow,
  primaryMonitor,
} from "@tauri-apps/api/window";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { shortDate, todayIso } from "../lib/dates";
import {
  areaOf,
  clampToArea,
  collapsedTab,
  dockPoint,
  growRect,
  pickArea,
  rightCenter,
  shrinkRect,
  type DeskArea,
  type DeskEdge,
  type DeskPoint,
  type DeskSize,
} from "../lib/deskWindow";
import { applyTheme, type AppliedTheme } from "../lib/theme";
import { errorText, setLanguage, t, type Language } from "../lib/i18n";
import { overdueDays } from "../model/mappers";
import { deskLeftButtonDown } from "../model/ipc";
import type { DeskPin, Task } from "../model/types";
import { deskVM } from "../viewmodels/deskVM";
import PriorityBadge from "./components/PriorityBadge.vue";
import StatusDot from "./components/StatusDot.vue";

/** Transparent room around the card for its CSS shadow; the shell's p-4 must match. */
const PAD_LOGICAL = 16;
/** Collapsed hint tab: the long side points into the screen, the short side runs along the edge. */
const TAB_LONG_LOGICAL = 56;
const TAB_SHORT_LOGICAL = 22;
const SNAP_LOGICAL = 24;
const SETTLE_MS = 250;
const SETTLE_RETRY_MS = 100;
const COLLAPSE_MS = 400;
const REFRESH_MS = 60_000;
const HOVER_REFRESH_MS = 10_000;

const vm = deskVM;
const { state, days, count } = vm;
const win = getCurrentWindow();

type DeskPhase = "open" | "closing" | "closed" | "opening";

/** The widget alternates between the panel and the edge tab through these phases. */
const phase = ref<DeskPhase>("open");
const edge = ref<DeskEdge | null>(null);
const pin = computed(() => state.pin);
/** Invalidates async animation continuations that a newer transition overtook. */
let animRun = 0;

/** Grow and shrink out of the edge the panel is docked to. */
const originClass = computed(() => {
  switch (edge.value) {
    case "top":
      return "origin-top";
    case "bottom":
      return "origin-bottom";
    case "left":
      return "origin-left";
    case "right":
      return "origin-right";
    default:
      return "origin-center";
  }
});

/** Round only the end facing away from the screen edge, so the tab reads like a page marker. */
const tabRadius = computed(() => {
  switch (edge.value) {
    case "left":
      return "rounded-r-xl";
    case "right":
      return "rounded-l-xl";
    case "top":
      return "rounded-b-xl";
    case "bottom":
      return "rounded-t-xl";
    default:
      return "rounded-xl";
  }
});

/** The tab shadow falls inward from the docked edge, never over it. */
const tabShadow = computed(() => {
  switch (edge.value) {
    case "top":
      return "shadow-[0_10px_18px_-10px_rgb(0_0_0/0.45)]";
    case "bottom":
      return "shadow-[0_-10px_18px_-10px_rgb(0_0_0/0.45)]";
    case "left":
      return "shadow-[10px_0_18px_-10px_rgb(0_0_0/0.45)]";
    case "right":
      return "shadow-[-10px_0_18px_-10px_rgb(0_0_0/0.45)]";
    default:
      return "shadow-lg";
  }
});

let scale = 1;
let pad = PAD_LOGICAL;
let tabLong = TAB_LONG_LOGICAL;
let tabShort = TAB_SHORT_LOGICAL;
/** The margin the current window geometry was applied with; measurements use it. */
let appliedPad = pad;
let full: DeskSize = { width: 360, height: 500 };
let expandedPos: DeskPoint = { x: 0, y: 0 };
let currentArea: DeskArea = { x: 0, y: 0, width: 0, height: 0 };
let enabled = false;
let hovering = false;
let geometryUntil = 0;
let lastMovedAt = 0;
let lastLoadedAt = 0;
let collapseTimer: ReturnType<typeof setTimeout> | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
const unlisteners: Array<() => void> = [];

function refresh(): void {
  lastLoadedAt = Date.now();
  void vm.load();
}

async function refreshMetrics(): Promise<void> {
  scale = await win.scaleFactor();
  const outer = await win.outerSize();
  if (outer.width > 0 && outer.height > 0) {
    full = { width: outer.width, height: outer.height };
  }
}

function syncMetrics(): void {
  pad = Math.round(PAD_LOGICAL * scale);
  tabLong = Math.round(TAB_LONG_LOGICAL * scale);
  tabShort = Math.round(TAB_SHORT_LOGICAL * scale);
}

async function applyGeometry(position: DeskPoint, size: DeskSize): Promise<void> {
  const rect = growRect({ position, size }, pad);
  appliedPad = pad;
  geometryUntil = Date.now() + SETTLE_MS + 250;
  try {
    await win.setPosition(new PhysicalPosition(rect.position.x, rect.position.y));
    await win.setSize(new PhysicalSize(rect.size.width, rect.size.height));
  } catch {
    // The window keeps its previous spot; the next move retries.
  }
}

async function applyPin(next: DeskPin): Promise<void> {
  try {
    if (next === "top") {
      await win.setAlwaysOnBottom(false);
      await win.setAlwaysOnTop(true);
    } else {
      await win.setAlwaysOnTop(false);
      await win.setAlwaysOnBottom(true);
    }
  } catch {
    // Keep the OS default z-order; the button label still reflects the choice.
  }
}

async function settle(): Promise<void> {
  if (phase.value !== "open") return;
  // The native move loop owns the window while the button is held; moving it then is undone at mouse-up.
  if (await deskLeftButtonDown().catch(() => false)) {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => void settle(), SETTLE_RETRY_MS);
    return;
  }
  const position = await win.outerPosition().catch(() => null);
  const size = await win.outerSize().catch(() => null);
  const monitor =
    (await currentMonitor().catch(() => null)) ?? (await primaryMonitor().catch(() => null));
  if (!position || !size || !monitor) return;

  const card = shrinkRect(
    {
      position: { x: position.x, y: position.y },
      size: { width: size.width, height: size.height },
    },
    appliedPad,
  );
  scale = await win.scaleFactor().catch(() => scale);
  syncMetrics();
  const area = areaOf(monitor.workArea);
  const docked = dockPoint(card.position, card.size, area, Math.round(SNAP_LOGICAL * scale));
  if (docked.position.x !== card.position.x || docked.position.y !== card.position.y) {
    await applyGeometry(docked.position, card.size);
  }

  full = card.size;
  expandedPos = docked.position;
  currentArea = area;
  edge.value = docked.edge;
  void vm.savePosition(docked.position.x, docked.position.y);
}

async function expand(): Promise<void> {
  clearTimeout(collapseTimer);
  if (phase.value === "open" || phase.value === "opening") return;
  animRun += 1;
  if (phase.value === "closing") {
    // The panel is still up: reversing its leave needs no window change.
    phase.value = "open";
    return;
  }
  phase.value = "opening";
  await nextTick();
  expandedPos = clampToArea(expandedPos, full, currentArea);
  await applyGeometry(expandedPos, full);
  if (phase.value === "opening") phase.value = "open";
}

function collapse(): void {
  if (phase.value !== "open" || !edge.value) return;
  phase.value = "closing";
}

/** The panel's leave is done: shrink the window, then let the edge tile fade in. */
async function afterCollapse(): Promise<void> {
  if (phase.value !== "closing" || !edge.value) return;
  const run = ++animRun;
  const rect = collapsedTab(edge.value, expandedPos, full, tabLong, tabShort, currentArea);
  await applyGeometry(rect.position, rect.size);
  if (run !== animRun) {
    // A reveal or expand took over while the window was shrinking.
    await applyGeometry(expandedPos, full);
    return;
  }
  if (phase.value === "closing") phase.value = "closed";
}

function onMouseEnter(): void {
  hovering = true;
  clearTimeout(collapseTimer);
  if (phase.value === "closed" || phase.value === "closing") void expand();
  if (Date.now() - lastLoadedAt > HOVER_REFRESH_MS) refresh();
}

/** A native drag fires a stream of moves; do not shrink the window under it. */
function maybeCollapse(): void {
  if (hovering) return;
  if (Date.now() - lastMovedAt < SETTLE_MS + 100) {
    collapseTimer = setTimeout(maybeCollapse, COLLAPSE_MS);
    return;
  }
  collapse();
}

function onMouseLeave(): void {
  hovering = false;
  clearTimeout(collapseTimer);
  if (phase.value !== "open" || !edge.value) return;
  collapseTimer = setTimeout(maybeCollapse, COLLAPSE_MS);
}

/** A press on the header starts a drag even right after a programmatic move. */
function beginMove(): void {
  clearTimeout(collapseTimer);
  if (phase.value === "closing") {
    animRun += 1;
    phase.value = "open";
  }
  geometryUntil = 0;
}

async function reveal(): Promise<void> {
  enabled = true;
  const monitor = await currentMonitor().catch(() => null);
  if (monitor) currentArea = areaOf(monitor.workArea);
  // Whatever animation was paused while hidden, the widget comes back expanded.
  animRun += 1;
  if (phase.value !== "open") {
    // Hide the tab before the window grows, or it paints at the panel's size.
    phase.value = "opening";
    await nextTick();
  }
  const docked = dockPoint(expandedPos, full, currentArea, Math.round(SNAP_LOGICAL * scale));
  expandedPos = docked.position;
  await applyGeometry(expandedPos, full);
  phase.value = "open";
  edge.value = docked.edge;
  refresh();
}

async function togglePin(): Promise<void> {
  const next = state.pin === "top" ? "bottom" : "top";
  await applyPin(next);
  await vm.setPin(next);
}

async function closeWidget(): Promise<void> {
  await vm.disable();
}

function openTask(task: Task): void {
  void emitTo("main", "desk:open-task", task.id);
}

/** Mirrors TaskRow: a task with steps is completed by ticking its steps in the sheet. */
function canStart(task: Task): boolean {
  return task.steps.length === 0 && task.status === "todo";
}

function canComplete(task: Task): boolean {
  return task.steps.length === 0 && task.status !== "done";
}

function stepsDone(task: Task): number {
  return task.steps.filter((step) => step.done).length;
}

function startRow(task: Task): void {
  void vm.start(task);
}

function suspendRow(task: Task): void {
  void vm.suspend(task);
}

function completeRow(task: Task): void {
  void vm.complete(task);
}

onMounted(async () => {
  await refreshMetrics().catch(() => {});
  syncMetrics();
  // Registered before the settings read so a toggle during startup is never lost.
  unlisteners.push(
    await listen<boolean>("desk:changed", (event) => {
      enabled = event.payload;
      if (!enabled) {
        clearTimeout(collapseTimer);
        void win.hide().catch(() => {});
      }
    }),
  );
  unlisteners.push(
    await listen<boolean>("desk:controls", (event) => {
      state.controls = event.payload;
    }),
  );
  let settings = null;
  try {
    settings = await vm.loadConfig();
  } catch {
    settings = null;
  }
  enabled = settings?.deskEnabled ?? true;

  const monitors = await availableMonitors().catch(() => []);
  const primary = await primaryMonitor().catch(() => null);
  const fallback = areaOf(
    primary?.workArea ??
      monitors[0]?.workArea ?? { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } },
  );
  const areas = monitors.map((monitor) => areaOf(monitor.workArea));
  const savedX = settings?.deskX ?? null;
  const savedY = settings?.deskY ?? null;
  const saved = savedX !== null && savedY !== null ? { x: savedX, y: savedY } : null;
  currentArea = pickArea(saved, full, areas, fallback);
  const docked = dockPoint(
    saved ?? rightCenter(currentArea, full),
    full,
    currentArea,
    Math.round(SNAP_LOGICAL * scale),
  );
  expandedPos = docked.position;
  await applyGeometry(expandedPos, full);
  edge.value = docked.edge;
  await applyPin(settings?.deskPin === "bottom" ? "bottom" : "top");

  unlisteners.push(
    await win.onMoved(() => {
      lastMovedAt = Date.now();
      if (Date.now() < geometryUntil || phase.value !== "open") return;
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => void settle(), SETTLE_MS);
    }),
  );
  unlisteners.push(
    await listen("desk:reveal", () => {
      void reveal();
    }),
  );
  unlisteners.push(
    await listen<AppliedTheme>("theme:changed", (event) => applyTheme(event.payload)),
  );
  unlisteners.push(
    await listen<Language>("language:changed", (event) => setLanguage(event.payload)),
  );
  unlisteners.push(
    await listen("ai:enriched", () => {
      refresh();
    }),
  );
  unlisteners.push(
    await listen("capture:created", () => {
      refresh();
    }),
  );

  await vm.load();
  lastLoadedAt = Date.now();
  if (enabled) await win.show().catch(() => {});
  refreshTimer = setInterval(refresh, REFRESH_MS);
});

onUnmounted(() => {
  animRun += 1;
  clearTimeout(collapseTimer);
  clearTimeout(settleTimer);
  clearInterval(refreshTimer);
  for (const unlisten of unlisteners) unlisten();
});
</script>

<template>
  <div class="h-screen p-4 text-base-content select-none">
    <Transition
      enter-active-class="transition-opacity duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-[scale,opacity] duration-150 ease-in motion-reduce:transition-none"
      leave-from-class="scale-100 opacity-100"
      leave-to-class="scale-[0.96] opacity-0"
      @after-leave="afterCollapse"
    >
      <div
        v-show="phase === 'open'"
        :class="originClass"
        class="flex h-full flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-lg"
        @mouseenter="onMouseEnter"
        @mouseleave="onMouseLeave"
      >
        <header
          data-tauri-drag-region
          class="flex h-9 shrink-0 items-center gap-2 border-b border-base-300 px-3"
          @mousedown="beginMove"
        >
          <span data-tauri-drag-region class="text-[13px] font-semibold">{{
            t("desk.title")
          }}</span>
          <span class="text-[10.5px] text-base-content/40">{{ t("desk.count", { count }) }}</span>
          <div class="ml-auto flex items-center gap-0.5">
            <button
              type="button"
              class="grid size-6 place-items-center rounded-md text-base-content/40 hover:bg-base-200 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
              :title="pin === 'top' ? t('desk.pinToBottom') : t('desk.pinToTop')"
              :aria-label="pin === 'top' ? t('desk.pinToBottom') : t('desk.pinToTop')"
              @click="togglePin"
            >
              <Pin :size="13" :class="{ 'rotate-180': pin === 'bottom' }" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="grid size-6 place-items-center rounded-md text-base-content/40 hover:bg-base-200 hover:text-error focus-visible:ring-2 focus-visible:ring-primary/40"
              :title="t('desk.close')"
              :aria-label="t('desk.close')"
              @click="closeWidget"
            >
              <X :size="14" aria-hidden="true" />
            </button>
          </div>
        </header>

        <main class="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
          <section v-for="day in days" :key="day.date">
            <div
              class="flex items-center gap-1.5 px-1 pt-1 pb-0.5 text-[10px] text-base-content/40"
            >
              <span class="font-medium">{{ day.weekday }}</span>
              <span>{{ shortDate(day.date) }}</span>
              <span v-if="day.isToday" class="badge badge-soft badge-primary badge-xs">{{
                t("week.today")
              }}</span>
            </div>
            <div
              v-for="row in day.rows"
              :key="row.task.id"
              class="flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1.5 hover:bg-base-200/70"
            >
              <button
                v-if="state.controls && canComplete(row.task)"
                type="button"
                class="flex shrink-0 rounded-full focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-60"
                :aria-label="t('task.doneAria', { title: row.task.title })"
                :title="t('task.doneAria', { title: row.task.title })"
                :disabled="state.busy"
                @click="completeRow(row.task)"
              >
                <StatusDot :status="row.task.status" :suspended="row.task.suspended" />
              </button>
              <span v-else class="shrink-0">
                <StatusDot :status="row.task.status" :suspended="row.task.suspended" />
              </span>
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 rounded-md text-left focus-visible:ring-2 focus-visible:ring-primary/40"
                :title="t('desk.openTask', { title: row.task.title })"
                :aria-label="t('desk.openTask', { title: row.task.title })"
                @click="openTask(row.task)"
              >
                <span class="min-w-0 flex-1 truncate text-[13px]">{{ row.task.title }}</span>
                <PriorityBadge :priority="row.task.priority" />
                <span
                  v-if="overdueDays(row.task.dueDate, todayIso()) > 0"
                  class="badge badge-soft badge-error badge-xs"
                  >{{
                    t("task.overdue", { days: overdueDays(row.task.dueDate, todayIso()) })
                  }}</span
                >
                <span v-if="row.task.carryCount" class="badge badge-ghost badge-xs">{{
                  t("task.carry", { count: row.task.carryCount })
                }}</span>
                <span v-if="row.task.steps.length" class="shrink-0 text-[10px] text-base-content/40"
                  >{{ stepsDone(row.task) }}/{{ row.task.steps.length }}</span
                >
                <span v-if="row.spans" class="shrink-0 text-[10px] text-base-content/35"
                  >→ {{ shortDate(row.end) }}</span
                >
              </button>
              <div v-if="state.controls" class="flex shrink-0 items-center gap-0.5">
                <button
                  v-if="canStart(row.task)"
                  type="button"
                  class="grid size-5 place-items-center rounded-md text-base-content/30 hover:bg-base-200 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
                  :aria-label="t('task.startAria', { title: row.task.title })"
                  :title="t('task.startAria', { title: row.task.title })"
                  :disabled="state.busy"
                  @click="startRow(row.task)"
                >
                  <Play :size="13" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  class="grid size-5 place-items-center rounded-md text-base-content/30 hover:bg-base-200 hover:text-warning focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
                  :aria-label="t('task.suspendAria', { title: row.task.title })"
                  :title="t('task.suspendAria', { title: row.task.title })"
                  :disabled="state.busy"
                  @click="suspendRow(row.task)"
                >
                  <Pause :size="13" aria-hidden="true" />
                </button>
              </div>
            </div>
          </section>
          <p
            v-if="!days.length && !state.loading"
            class="px-1 py-2 text-[12px] text-base-content/40"
          >
            {{ t("desk.empty") }}
          </p>
          <p v-if="state.failed" class="px-1 py-1 text-[10.5px] text-error">
            {{ t("desk.loadFailed") }}
          </p>
          <p v-if="state.actionError" class="px-1 py-1 text-[10.5px] text-error">
            {{ t("desk.actionFailed", { error: errorText(state.actionError) }) }}
          </p>
        </main>
      </div>
    </Transition>
    <Transition
      enter-active-class="transition duration-150 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      enter-from-class="scale-90 opacity-0"
      enter-to-class="scale-100 opacity-100"
      leave-active-class="duration-0"
    >
      <button
        v-if="phase === 'closed'"
        type="button"
        :class="[originClass, tabShadow, tabRadius]"
        class="grid size-full place-items-center border border-base-300 bg-base-100 focus-visible:ring-2 focus-visible:ring-primary/40"
        :aria-label="t('desk.expand')"
        :title="t('desk.expand')"
        @mouseenter="onMouseEnter"
        @mouseleave="onMouseLeave"
        @click="expand"
      >
        <span
          class="flex items-center justify-center gap-[3px]"
          :class="edge === 'top' || edge === 'bottom' ? 'flex-col' : ''"
        >
          <i v-for="n in 3" :key="n" class="block size-[2.5px] rounded-full bg-base-content/30"></i>
        </span>
      </button>
    </Transition>
  </div>
</template>

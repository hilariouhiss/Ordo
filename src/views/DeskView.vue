<script setup lang="ts">
import { Maximize2, Pause, Pin, Play } from "@lucide/vue";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { shortDate, todayIso } from "../lib/dates";
import {
  DESK_PAD,
  DESK_PANEL,
  DESK_TAB_LONG,
  DESK_TAB_SHORT,
  clampToArea,
  collapsedTab,
  growRect,
  shrinkRect,
  widgetPlacement,
  type DeskArea,
  type DeskEdge,
  type DeskPoint,
  type DeskRect,
  type DeskSize,
} from "../lib/deskWindow";
import { applyDeskPin, readDeskMonitors, readWindowRect } from "../lib/deskMonitors";
import { errorText, t } from "../lib/i18n";
import { canSuspendTask } from "../lib/status";
import { flatRect, prefersReducedMotion, tweenRect } from "../lib/windowMotion";
import { overdueDays } from "../model/mappers";
import { deskLeftButtonDown, setWindowRect } from "../model/ipc";
import type { Task } from "../model/types";
import { deskVM } from "../viewmodels/deskVM";
import PriorityBadge from "./components/PriorityBadge.vue";
import StatusDot from "./components/StatusDot.vue";

const props = defineProps<{ active: boolean }>();
const emit = defineEmits<{
  "open-task": [string];
  back: [];
  "collapse-change": [boolean];
}>();

const SETTLE_MS = 250;
const SETTLE_RETRY_MS = 100;
const COLLAPSE_DELAY_MS = 400;
/** The card and the window shrink into the edge tab together, one frame at a time. */
const DOCK_MS = 200;
const REFRESH_MS = 60_000;
const HOVER_REFRESH_MS = 10_000;
/** Grace period before a focus loss restores; clicking back cancels it. */
const SUMMON_RESTORE_MS = 150;

const vm = deskVM;
const { state, days, count } = vm;

/** The tab is the card at its collapsed size; this is the shape the widget heads for. */
const collapsed = ref(false);
/** A shape tween owns the native window right now. */
const moving = ref(false);
const edge = ref<DeskEdge | null>(null);
const pin = computed(() => state.pin);
/** A newer tween overtook an async animation continuation. */
let animRun = 0;
/** A hotkey summoned the widget; put this state back when it loses focus. */
let summoned: { hidden: boolean; collapsed: boolean } | null = null;
let restoreTimer: ReturnType<typeof setTimeout> | undefined;

let scale = 1;
let pad = DESK_PAD;
let tabLong = DESK_TAB_LONG;
let tabShort = DESK_TAB_SHORT;
let full: DeskSize = { width: DESK_PANEL.width, height: DESK_PANEL.height };
let expandedPos: DeskPoint = { x: 0, y: 0 };
let currentArea: DeskArea = { x: 0, y: 0, width: 0, height: 0 };
let savedPos: DeskPoint | null = null;
let running = false;
let hovering = false;
let geometryUntil = 0;
let lastMovedAt = 0;
let lastLoadedAt = 0;
let collapseTimer: ReturnType<typeof setTimeout> | undefined;
let settleTimer: ReturnType<typeof setTimeout> | undefined;
let refreshTimer: ReturnType<typeof setInterval> | undefined;
let moveUnlisten: (() => void) | null = null;
const unlisteners: Array<() => void> = [];

let cachedWin: Window | null = null;
function win(): Window {
  cachedWin ??= getCurrentWindow();
  return cachedWin;
}

/** Fills the window while docked, but stays a 360x500 panel inside the larger mode-morph window. */
const cardStyle = {
  width: `min(${DESK_PANEL.width}px, calc(100% - ${DESK_PAD * 2}px))`,
  height: `min(${DESK_PANEL.height}px, calc(100% - ${DESK_PAD * 2}px))`,
};

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

watch(collapsed, (next) => emit("collapse-change", next));

watch(
  () => props.active,
  (active) => {
    if (active) void activate();
    else void deactivate();
  },
);

function refresh(): void {
  lastLoadedAt = Date.now();
  void vm.load();
}

async function applyGeometry(position: DeskPoint, size: DeskSize): Promise<void> {
  // The mode transition owns the window once the widget is deactivated.
  if (!running) return;
  const rect = growRect({ position, size }, pad);
  geometryUntil = Date.now() + SETTLE_MS + 250;
  await setWindowRect(rect.position.x, rect.position.y, rect.size.width, rect.size.height).catch(
    () => {},
  );
}

/** One native move per frame; the card fills the window, so the two shrink and grow as one. */
async function tweenGeometry(to: DeskRect, ms: number, run: number): Promise<void> {
  const target = flatRect(growRect(to, pad));
  const from = await readWindowRect().catch(() => null);
  if (run !== animRun || !running) return;
  if (!from || prefersReducedMotion()) {
    await applyGeometry(to.position, to.size);
    return;
  }
  geometryUntil = Date.now() + ms + SETTLE_MS + 250;
  await tweenRect(flatRect(from), target, ms, (rect) => {
    if (run !== animRun || !running) return false;
    void setWindowRect(rect.x, rect.y, rect.width, rect.height).catch(() => {});
    return true;
  });
  if (run !== animRun || !running) return;
  await applyGeometry(to.position, to.size);
}

/**
 * Grows or shrinks the card and the window in one motion. A request for the
 * other shape cancels the tween and reverses from wherever the window is.
 */
async function shape(next: boolean): Promise<void> {
  const docked = edge.value;
  if (!running || collapsed.value === next) return;
  if (next && !docked) return;
  collapsed.value = next;
  if (!next) expandedPos = clampToArea(expandedPos, full, currentArea);
  const target =
    next && docked
      ? collapsedTab(docked, expandedPos, full, tabLong, tabShort, currentArea)
      : { position: expandedPos, size: full };
  const run = ++animRun;
  moving.value = true;
  await tweenGeometry(target, DOCK_MS, run);
  if (run !== animRun || !running) return;
  moving.value = false;
  // The pointer left while the panel was still growing: settle back down.
  if (!next && !hovering && !summoned?.collapsed) scheduleCollapse();
}

async function expand(): Promise<void> {
  clearTimeout(collapseTimer);
  await shape(false);
}

function applyPlacement(placed: ReturnType<typeof widgetPlacement>): void {
  scale = placed.scale;
  pad = placed.pad;
  full = placed.card.size;
  tabLong = Math.round(DESK_TAB_LONG * scale);
  tabShort = Math.round(DESK_TAB_SHORT * scale);
  expandedPos = placed.card.position;
  currentArea = placed.area;
  edge.value = placed.edge;
}

async function activate(): Promise<void> {
  if (running) return;
  running = true;
  animRun += 1;
  collapsed.value = false;
  moving.value = false;
  clearTimeout(collapseTimer);
  hovering = false;
  try {
    const { list, primary } = await readDeskMonitors();
    if (!running) return;
    const placed = widgetPlacement({ saved: savedPos, monitors: list, primary });
    applyPlacement(placed);
    await applyGeometry(expandedPos, full);
    if (!running) return;
    await applyDeskPin(win(), pin.value);
    await subscribeMove();
    if (!running) return;
    refreshTimer = setInterval(refresh, REFRESH_MS);
    if (Date.now() - lastLoadedAt > HOVER_REFRESH_MS) refresh();
  } catch {
    // The window keeps whatever shape the mode transition gave it.
  }
}

async function deactivate(): Promise<void> {
  if (!running) return;
  running = false;
  summoned = null;
  clearTimeout(restoreTimer);
  animRun += 1;
  moving.value = false;
  clearTimeout(collapseTimer);
  clearTimeout(settleTimer);
  clearInterval(refreshTimer);
  refreshTimer = undefined;
  hovering = false;
  moveUnlisten?.();
  moveUnlisten = null;
}

async function subscribeMove(): Promise<void> {
  moveUnlisten?.();
  const unlisten = await win().onMoved(() => {
    if (Date.now() < geometryUntil || collapsed.value || moving.value) return;
    lastMovedAt = Date.now();
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => void settle(), SETTLE_MS);
  });
  if (running) moveUnlisten = unlisten;
  else unlisten();
}

async function settle(): Promise<void> {
  if (!running || collapsed.value || moving.value) return;
  // The native move loop owns the window while the button is held; moving it then is undone at mouse-up.
  if (await deskLeftButtonDown().catch(() => false)) {
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => void settle(), SETTLE_RETRY_MS);
    return;
  }
  const rect = await readWindowRect().catch(() => null);
  if (!rect) return;
  const currentScale = await win()
    .scaleFactor()
    .catch(() => scale);
  const current = shrinkRect(rect, Math.round(DESK_PAD * currentScale));
  const { list, primary } = await readDeskMonitors();
  const placed = widgetPlacement({ saved: current.position, monitors: list, primary });
  if (!running || collapsed.value || moving.value) return;
  const moved =
    placed.card.position.x !== expandedPos.x ||
    placed.card.position.y !== expandedPos.y ||
    placed.card.size.width !== full.width ||
    placed.card.size.height !== full.height;
  applyPlacement(placed);
  if (moved) await applyGeometry(expandedPos, full);
  void vm.savePosition(expandedPos.x, expandedPos.y);
}

function scheduleCollapse(): void {
  clearTimeout(collapseTimer);
  collapseTimer = setTimeout(maybeCollapse, COLLAPSE_DELAY_MS);
}

/** A native drag fires a stream of moves; do not shrink the window under it. */
function maybeCollapse(): void {
  if (summoned?.collapsed || hovering || collapsed.value || !edge.value) return;
  if (Date.now() - lastMovedAt < SETTLE_MS + 100) {
    collapseTimer = setTimeout(maybeCollapse, COLLAPSE_DELAY_MS);
    return;
  }
  void shape(true);
}

function onMouseEnter(): void {
  hovering = true;
  clearTimeout(collapseTimer);
  if (collapsed.value || moving.value) void expand();
  if (Date.now() - lastLoadedAt > HOVER_REFRESH_MS) refresh();
}

function onMouseLeave(): void {
  hovering = false;
  clearTimeout(collapseTimer);
  if (!collapsed.value) scheduleCollapse();
}

/** A press on the header starts a drag even right after a programmatic move. */
function beginMove(): void {
  clearTimeout(collapseTimer);
  geometryUntil = 0;
}

async function togglePin(): Promise<void> {
  const next = state.pin === "top" ? "bottom" : "top";
  await applyDeskPin(win(), next);
  await vm.setPin(next);
}

function openTask(task: Task): void {
  emit("open-task", task.id);
}

function back(): void {
  emit("back");
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

/** The hotkey asked for the widget; raise it, expand a docked tab, remember how to put it back. */
async function summonFromHotkey(hidden: boolean): Promise<void> {
  if (!running || !props.active) return;
  clearTimeout(restoreTimer);
  // A press while it was hidden starts a fresh session; a repeat press while it is
  // still on screen keeps the state captured before the first summon.
  if (!summoned || hidden) summoned = { hidden, collapsed: collapsed.value };
  if (summoned.collapsed) clearTimeout(collapseTimer);
  // Dropping the bottom layer cannot raise the window; topmost is the way up.
  await win()
    .setAlwaysOnBottom(false)
    .catch(() => {});
  await win()
    .setAlwaysOnTop(true)
    .catch(() => {});
  await win()
    .setFocus()
    .catch(() => {});
  if (summoned.collapsed && collapsed.value) await expand();
  if (Date.now() - lastLoadedAt > HOVER_REFRESH_MS) refresh();
}

/** Puts the widget back the way the hotkey found it after it loses focus. */
async function restoreSummoned(): Promise<void> {
  const session = summoned;
  if (!session) return;
  const focused = (): Promise<boolean> =>
    win()
      .isFocused()
      .catch(() => false);
  if (await focused()) return;
  if (session.collapsed) {
    await shape(true);
    if (!running) return;
    // Clicked back while it was folding: keep it summoned.
    if (await focused()) {
      await expand();
      return;
    }
  }
  summoned = null;
  if (session.hidden)
    await win()
      .hide()
      .catch(() => {});
  if (state.pin === "bottom") {
    await applyDeskPin(win(), "bottom");
  } else {
    // Keep a top-pinned widget on top instead of dropping and re-raising it.
    await win()
      .setAlwaysOnBottom(false)
      .catch(() => {});
    await win()
      .setAlwaysOnTop(true)
      .catch(() => {});
  }
}

function onWindowBlur(): void {
  if (!summoned) return;
  clearTimeout(restoreTimer);
  restoreTimer = setTimeout(() => void restoreSummoned(), SUMMON_RESTORE_MS);
}

function onWindowFocus(): void {
  clearTimeout(restoreTimer);
}

onMounted(async () => {
  // Register the summon before the first awaits so a hotkey right after the
  // window appears is not missed.
  unlisteners.push(
    await listen<boolean>("widget:summon", (event) => {
      void summonFromHotkey(event.payload === true);
    }),
  );
  window.addEventListener("blur", onWindowBlur);
  window.addEventListener("focus", onWindowFocus);
  const settings = await vm.loadConfig().catch(() => null);
  savedPos =
    settings && settings.deskX !== null && settings.deskY !== null
      ? { x: settings.deskX, y: settings.deskY }
      : null;
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
  if (props.active) await activate();
});

onUnmounted(() => {
  animRun += 1;
  summoned = null;
  clearTimeout(restoreTimer);
  clearTimeout(collapseTimer);
  clearTimeout(settleTimer);
  clearInterval(refreshTimer);
  moveUnlisten?.();
  window.removeEventListener("blur", onWindowBlur);
  window.removeEventListener("focus", onWindowFocus);
  for (const unlisten of unlisteners) unlisten();
});
</script>

<template>
  <div class="relative h-full text-base-content select-none">
    <div
      :class="[
        collapsed ? tabRadius : 'rounded-2xl',
        collapsed && !moving ? tabShadow : 'shadow-lg',
      ]"
      :style="cardStyle"
      class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 overflow-hidden border border-base-300 bg-base-100 transition-[border-radius] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    >
      <div
        :inert="!props.active || collapsed || moving"
        class="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col transition-opacity ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
        :class="collapsed ? 'opacity-0 duration-100' : 'delay-100 opacity-100 duration-150'"
        :style="{ width: `${DESK_PANEL.width}px`, height: `${DESK_PANEL.height}px` }"
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
              class="grid size-6 place-items-center rounded-md text-base-content/40 hover:bg-base-200 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/40"
              :title="t('desk.backToMain')"
              :aria-label="t('desk.backToMain')"
              @click="back"
            >
              <Maximize2 :size="14" aria-hidden="true" />
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
                  v-if="canSuspendTask(row.task)"
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
      <button
        type="button"
        class="absolute inset-[2px] grid place-items-center rounded-[inherit] transition-opacity duration-150 motion-reduce:transition-none"
        :class="
          collapsed
            ? 'delay-100 opacity-100 focus-visible:ring-2 focus-visible:ring-primary/40'
            : 'pointer-events-none opacity-0'
        "
        :tabindex="collapsed && props.active ? 0 : -1"
        :aria-hidden="!collapsed"
        :aria-label="t('desk.expand')"
        :title="t('desk.expand')"
        @click="expand"
      >
        <span
          class="flex items-center justify-center gap-[3px]"
          :class="edge === 'top' || edge === 'bottom' ? 'flex-col' : ''"
        >
          <i v-for="n in 3" :key="n" class="block size-[2.5px] rounded-full bg-base-content/30"></i>
        </span>
      </button>
    </div>
  </div>
</template>

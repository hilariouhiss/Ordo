<script setup lang="ts">
import { Maximize2, Pause, Pin, Play } from "@lucide/vue";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow, type Window } from "@tauri-apps/api/window";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
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
  type DeskSize,
} from "../lib/deskWindow";
import { readDeskMonitors, readWindowRect } from "../lib/deskMonitors";
import { errorText, t } from "../lib/i18n";
import { overdueDays } from "../model/mappers";
import { deskLeftButtonDown } from "../model/ipc";
import type { DeskPin, Task } from "../model/types";
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
const COLLAPSE_MS = 400;
const REFRESH_MS = 60_000;
const HOVER_REFRESH_MS = 10_000;

const vm = deskVM;
const { state, days, count } = vm;

type DeskPhase = "open" | "closing" | "closed" | "opening";

/** The widget alternates between the panel and the edge tab through these phases. */
const phase = ref<DeskPhase>("open");
const edge = ref<DeskEdge | null>(null);
const pin = computed(() => state.pin);
/** A newer transition overtook an async animation continuation. */
let animRun = 0;

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

watch(phase, (next) => emit("collapse-change", next === "closed"));

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
  try {
    await win().setPosition(new PhysicalPosition(rect.position.x, rect.position.y));
    await win().setSize(new PhysicalSize(rect.size.width, rect.size.height));
  } catch {
    // The window keeps its previous spot; the next move retries.
  }
}

async function applyPin(next: DeskPin): Promise<void> {
  try {
    if (next === "top") {
      await win().setAlwaysOnBottom(false);
      await win().setAlwaysOnTop(true);
    } else {
      await win().setAlwaysOnTop(false);
      await win().setAlwaysOnBottom(true);
    }
  } catch {
    // Keep the OS default z-order; the button label still reflects the choice.
  }
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
  try {
    const { list, primary } = await readDeskMonitors();
    if (!running) return;
    const placed = widgetPlacement({ saved: savedPos, monitors: list, primary });
    applyPlacement(placed);
    await applyGeometry(expandedPos, full);
    if (!running) return;
    await applyPin(pin.value);
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
  animRun += 1;
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
    lastMovedAt = Date.now();
    if (Date.now() < geometryUntil || phase.value !== "open") return;
    clearTimeout(settleTimer);
    settleTimer = setTimeout(() => void settle(), SETTLE_MS);
  });
  if (running) moveUnlisten = unlisten;
  else unlisten();
}

async function settle(): Promise<void> {
  if (phase.value !== "open" || !running) return;
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
  const moved =
    placed.card.position.x !== expandedPos.x ||
    placed.card.position.y !== expandedPos.y ||
    placed.card.size.width !== full.width ||
    placed.card.size.height !== full.height;
  applyPlacement(placed);
  if (moved) await applyGeometry(expandedPos, full);
  void vm.savePosition(expandedPos.x, expandedPos.y);
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
  if (!running) return;
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
  if (!running) return;
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

async function togglePin(): Promise<void> {
  const next = state.pin === "top" ? "bottom" : "top";
  await applyPin(next);
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

onMounted(async () => {
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
  clearTimeout(collapseTimer);
  clearTimeout(settleTimer);
  clearInterval(refreshTimer);
  moveUnlisten?.();
  for (const unlisten of unlisteners) unlisten();
});
</script>

<template>
  <div class="relative h-full text-base-content select-none">
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
        :style="{ width: `${DESK_PANEL.width}px`, height: `${DESK_PANEL.height}px` }"
        class="absolute top-1/2 left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-lg"
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
                  v-if="canStart(row.task)"
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
        class="absolute inset-4 grid place-items-center border border-base-300 bg-base-100 focus-visible:ring-2 focus-visible:ring-primary/40"
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

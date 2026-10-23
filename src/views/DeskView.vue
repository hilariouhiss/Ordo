<script setup lang="ts">
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Pause,
  Pin,
  Play,
  X,
} from "@lucide/vue";
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
  collapsedRect,
  nearestEdge,
  pickArea,
  rightCenter,
  snapToEdge,
  type DeskArea,
  type DeskEdge,
  type DeskPoint,
  type DeskSize,
} from "../lib/deskWindow";
import { applyTheme, type AppliedTheme } from "../lib/theme";
import { errorText, setLanguage, t, type Language } from "../lib/i18n";
import { overdueDays } from "../model/mappers";
import type { DeskPin, Task } from "../model/types";
import { deskVM } from "../viewmodels/deskVM";
import StatusDot from "./components/StatusDot.vue";

const PEEK_LOGICAL = 12;
const SNAP_LOGICAL = 24;
const SETTLE_MS = 250;
const COLLAPSE_MS = 400;
const REFRESH_MS = 60_000;
const HOVER_REFRESH_MS = 10_000;

const vm = deskVM;
const { state, days, count } = vm;
const win = getCurrentWindow();

const collapsed = ref(false);
const edge = ref<DeskEdge | null>(null);
const pin = computed(() => state.pin);
const grabIcon = computed(() => {
  switch (edge.value) {
    case "left":
      return ChevronRight;
    case "top":
      return ChevronDown;
    case "bottom":
      return ChevronUp;
    default:
      return ChevronLeft;
  }
});

let scale = 1;
let full: DeskSize = { width: 320, height: 460 };
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

async function applyGeometry(position: DeskPoint, size: DeskSize): Promise<void> {
  geometryUntil = Date.now() + SETTLE_MS + 250;
  try {
    await win.setPosition(new PhysicalPosition(position.x, position.y));
    await win.setSize(new PhysicalSize(size.width, size.height));
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
  if (collapsed.value) return;
  const position = await win.outerPosition().catch(() => null);
  const size = await win.outerSize().catch(() => null);
  const monitor =
    (await currentMonitor().catch(() => null)) ?? (await primaryMonitor().catch(() => null));
  if (!position || !size || !monitor) return;

  scale = await win.scaleFactor().catch(() => scale);
  const point = { x: position.x, y: position.y };
  const dims = { width: size.width, height: size.height };
  const area = areaOf(monitor.workArea);
  const found = nearestEdge(point, dims, area, Math.round(SNAP_LOGICAL * scale));
  const next = found ? snapToEdge(found, point, dims, area) : clampToArea(point, dims, area);
  if (next.x !== point.x || next.y !== point.y) await applyGeometry(next, dims);

  full = dims;
  expandedPos = next;
  currentArea = area;
  edge.value = found;
  void vm.savePosition(next.x, next.y);
}

async function expand(): Promise<void> {
  clearTimeout(collapseTimer);
  if (!collapsed.value) return;
  collapsed.value = false;
  await nextTick();
  const point = clampToArea(expandedPos, full, currentArea);
  expandedPos = point;
  await applyGeometry(point, full);
}

async function collapse(): Promise<void> {
  if (collapsed.value || !edge.value) return;
  const rect = collapsedRect(
    edge.value,
    expandedPos,
    full,
    Math.max(8, Math.round(PEEK_LOGICAL * scale)),
    currentArea,
  );
  collapsed.value = true;
  await nextTick();
  await applyGeometry(rect.position, rect.size);
}

function onMouseEnter(): void {
  hovering = true;
  clearTimeout(collapseTimer);
  if (collapsed.value) void expand();
  if (Date.now() - lastLoadedAt > HOVER_REFRESH_MS) refresh();
}

/** A native drag fires a stream of moves; do not shrink the window under it. */
function maybeCollapse(): void {
  if (hovering) return;
  if (Date.now() - lastMovedAt < SETTLE_MS + 100) {
    collapseTimer = setTimeout(maybeCollapse, COLLAPSE_MS);
    return;
  }
  void collapse();
}

function onMouseLeave(): void {
  hovering = false;
  clearTimeout(collapseTimer);
  if (!edge.value) return;
  collapseTimer = setTimeout(maybeCollapse, COLLAPSE_MS);
}

/** A press on the header starts a drag even right after a programmatic move. */
function beginMove(): void {
  geometryUntil = 0;
}

async function reveal(): Promise<void> {
  enabled = true;
  const monitor = await currentMonitor().catch(() => null);
  if (monitor) currentArea = areaOf(monitor.workArea);
  if (collapsed.value) {
    expandedPos = clampToArea(expandedPos, full, currentArea);
    await expand();
  } else {
    const point = clampToArea(expandedPos, full, currentArea);
    if (point.x !== expandedPos.x || point.y !== expandedPos.y) {
      expandedPos = point;
      await applyGeometry(point, full);
    }
  }
  edge.value = nearestEdge(expandedPos, full, currentArea, Math.round(SNAP_LOGICAL * scale));
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
  expandedPos = saved ? clampToArea(saved, full, currentArea) : rightCenter(currentArea, full);
  await applyGeometry(expandedPos, full);
  edge.value = nearestEdge(expandedPos, full, currentArea, Math.round(SNAP_LOGICAL * scale));
  await applyPin(settings?.deskPin === "bottom" ? "bottom" : "top");

  unlisteners.push(
    await win.onMoved(() => {
      lastMovedAt = Date.now();
      if (Date.now() < geometryUntil || collapsed.value) return;
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
  clearTimeout(collapseTimer);
  clearTimeout(settleTimer);
  clearInterval(refreshTimer);
  for (const unlisten of unlisteners) unlisten();
});
</script>

<template>
  <div
    class="flex h-screen flex-col overflow-hidden bg-base-100 text-base-content select-none"
    @mouseenter="onMouseEnter"
    @mouseleave="onMouseLeave"
  >
    <button
      v-if="collapsed"
      type="button"
      class="grid h-full w-full place-items-center bg-base-100 text-base-content/40 hover:text-primary"
      :aria-label="t('desk.expand')"
      :title="t('desk.expand')"
      @click="expand"
    >
      <component :is="grabIcon" :size="12" aria-hidden="true" />
    </button>
    <template v-else>
      <header
        data-tauri-drag-region
        class="flex h-9 shrink-0 items-center gap-2 border-b border-base-300 px-3"
        @mousedown="beginMove"
      >
        <span data-tauri-drag-region class="text-[12.5px] font-semibold">{{
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
          <div class="flex items-center gap-1.5 px-1 pt-1 pb-0.5 text-[10px] text-base-content/40">
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
              <span class="min-w-0 flex-1 truncate text-[12.5px]">{{ row.task.title }}</span>
              <span
                v-if="row.task.priority === 'high'"
                class="badge badge-soft badge-warning badge-xs"
                >{{ t("task.priorityHigh") }}</span
              >
              <span
                v-if="overdueDays(row.task.dueDate, todayIso()) > 0"
                class="badge badge-soft badge-error badge-xs"
                >{{ t("task.overdue", { days: overdueDays(row.task.dueDate, todayIso()) }) }}</span
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
        <p v-if="!days.length && !state.loading" class="px-1 py-2 text-[12px] text-base-content/40">
          {{ t("desk.empty") }}
        </p>
        <p v-if="state.failed" class="px-1 py-1 text-[10.5px] text-error">
          {{ t("desk.loadFailed") }}
        </p>
        <p v-if="state.actionError" class="px-1 py-1 text-[10.5px] text-error">
          {{ t("desk.actionFailed", { error: errorText(state.actionError) }) }}
        </p>
      </main>
    </template>
  </div>
</template>

<script setup lang="ts">
import { GripVertical } from "@lucide/vue";
import { AnimatePresence } from "motion-v";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { shortDate, todayIso, weekWorkdays, weekdayLabel } from "../lib/dates";
import { formatEffort } from "../lib/effort";
import { t } from "../lib/i18n";
import { fillPlannedDays } from "../lib/plan";
import { usePointerDrag } from "../lib/pointerDrag";
import { ganttDropAt, listDropAt } from "../lib/weekDrop";
import type { Task } from "../model/types";
import { appVM } from "../viewmodels/appVM";
import { passVM } from "../viewmodels/passVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { weekVM } from "../viewmodels/weekVM";
import CaptureBar from "./components/CaptureBar.vue";
import StatusDot from "./components/StatusDot.vue";
import TaskRow from "./components/TaskRow.vue";
import WeekGantt from "./components/WeekGantt.vue";
import TaskSheet from "./overlays/TaskSheet.vue";
import WeeklyPass from "./overlays/WeeklyPass.vue";

const {
  state,
  today,
  week,
  weekTasks,
  laterTasks,
  lanes,
  days,
  plan,
  loads,
  planEnd,
  overloadDates,
  conflictCount,
  passNeeded,
  load,
  markSeen,
  capture,
  resume,
  move,
  place,
  moveBy,
} = weekVM;
const overloadText = computed(() => overloadDates.value.map((date) => shortDate(date)).join(" · "));
const suspendedOpen = computed(() => state.suspended.length > 0);
const ganttView = computed(() => appVM.state.settings?.weekView === "gantt");

const listEl = ref<HTMLElement | null>(null);
/** The list's drag: threshold, the day and row under the pointer, edge auto-scroll. */
const drag = usePointerDrag<{ day: string; beforeId: string | null }>({
  targetOf: ({ y }) => listDropAt(listEl.value, y),
  scroller: () => listEl.value?.closest("main") ?? null,
  drop: (id, target) => {
    // The anchor is read while the drag still counts as live: a suspended drag may have
    // filled days that disappear again as soon as it ends.
    const beforeId = anchorFor(target.day, target.beforeId);
    if (plannedDays.value.get(id)?.has(target.day)) void move(id, beforeId);
    else void place(id, target.day, beforeId);
  },
});

/**
 * The bottom stack's drag: a card planned after this week lands on a day of the week,
 * moves its expected start there, and joins the queue from that day.
 */
const poolDragged = ref(false);
const poolDrag = usePointerDrag<{ day: string; beforeId: string | null }>({
  // The list and the gantt measure differently; both go through the shared helpers, so a
  // card lands exactly where a bar or a row would.
  targetOf: ({ x, y }) => {
    if (ganttView.value) {
      const grid = document.querySelector<HTMLElement>("[data-gantt-grid]");
      if (!grid) return null;
      // The stack sits below the grid, so only a pointer inside it reads as a day.
      const box = grid.getBoundingClientRect();
      if (y < box.top || y >= box.bottom) return null;
      const drop = ganttDropAt(grid, x, y, week.value.length);
      return drop ? { day: week.value[drop.column], beforeId: drop.before } : null;
    }
    return listDropAt(listEl.value, y);
  },
  scroller: () =>
    (ganttView.value
      ? document.querySelector<HTMLElement>("[data-gantt-grid]")
      : listEl.value
    )?.closest("main") ?? null,
  drop: (id, target) => {
    // A drag ends with a click; the sheet must not open too.
    poolDragged.value = true;
    window.setTimeout(() => (poolDragged.value = false), 0);
    const beforeId = ganttView.value ? target.beforeId : anchorFor(target.day, target.beforeId);
    void place(id, target.day, beforeId);
  },
});
const poolDraggingId = poolDrag.id;
const poolTarget = poolDrag.target;
const poolMoved = poolDrag.moved;
/** The gantt column under the stacked card, when the card hovers a day of the week. */
const poolColumn = computed(() => {
  const day = poolTarget.value?.day;
  const index = day ? week.value.indexOf(day) : -1;
  return index >= 0 ? index : null;
});
const draggingId = computed(() => drag.id.value ?? poolDrag.id.value);
const dropTarget = computed(() => drag.target.value ?? poolDrag.target.value);
const dragMoved = computed(() => drag.moved.value || poolDrag.moved.value);

const draggingSuspended = computed(
  () => draggingId.value !== null && state.suspended.some((task) => task.id === draggingId.value),
);
/**
 * A parked task still needs somewhere to land. With the empty-day setting off the list
 * can be empty, so a suspended drag temporarily fills this week's workdays back in.
 */
const shownDays = computed(() => {
  if (days.value.length || !(draggingSuspended.value || poolMoved.value)) return days.value;
  const today = todayIso();
  return fillPlannedDays(days.value, weekWorkdays(today), plan.value, today);
});
/** Nothing to show: the list's empty days and the gantt's lanes are the two cases. */
const emptyWeek = computed(() => {
  if (state.loading || weekTasks.value.length) return false;
  return ganttView.value ? !lanes.value.length : !shownDays.value.length;
});
/** The days each open task already shows on, so a drop inside them only reorders. */
const plannedDays = computed(() => {
  const dates = new Map<string, Set<string>>();
  for (const day of shownDays.value) {
    for (const row of day.rows) {
      if (row.history) continue;
      const shown = dates.get(row.task.id) ?? new Set<string>();
      shown.add(day.date);
      dates.set(row.task.id, shown);
    }
  }
  return dates;
});

/** The handle starts the drag; a right click does not. */
function startDrag(event: PointerEvent, id: string): void {
  if (event.button !== 0) return;
  drag.start(event, id);
}

/**
 * The global anchor for a day-local drop: the first task of a later day when the drop
 * lands after the day's last row, so `move_task` leaves it at the bottom of that day.
 */
function anchorFor(day: string, beforeId: string | null): string | null {
  if (beforeId) return beforeId;
  const index = shownDays.value.findIndex((entry) => entry.date === day);
  for (const later of shownDays.value.slice(index + 1)) {
    // Finished rows are read-only and cannot anchor a move.
    const first = later.rows.find((row) => !row.history);
    if (first) return first.task.id;
  }
  return null;
}

/** Keyboard reordering keeps focus on the same handle, even across a day boundary. */
async function onMoveBy(taskId: string, delta: -1 | 1): Promise<void> {
  await moveBy(taskId, delta);
  await nextTick();
  listEl.value?.querySelector<HTMLElement>(`[data-task-id="${taskId}"] button`)?.focus();
}

function onKey(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  drag.cancel();
  poolDrag.cancel();
}

const DAY_TICK_MS = 60_000;
let dayTick: ReturnType<typeof setInterval> | undefined;

/** The window can stay open past midnight, so the today mark and the week columns must follow. */
function checkDay(): void {
  if (draggingId.value || todayIso() === today.value) return;
  refresh();
}

/** The tray window can stay open across midnight, so refresh today and the plan on return. */
function onWindowFocus(): void {
  if (draggingId.value) return;
  void appVM.load();
  void load();
  void markSeen();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("focus", onWindowFocus);
  void load();
  // Seeing this page is what clears the tray's unread count; other pages do not.
  void markSeen();
  dayTick = window.setInterval(checkDay, DAY_TICK_MS);
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("focus", onWindowFocus);
  window.clearInterval(dayTick);
});

watch(
  () => passVM.state.open,
  (open, previous) => {
    if (previous && !open) {
      void appVM.load();
      void load();
    }
  },
);

watch(
  () => taskSheetVM.state.openId,
  (open) => {
    if (!open) void load();
  },
);

function dayLoad(date: string): number {
  return loads.value.get(date) ?? 0;
}

function openTask(task: Task): void {
  void taskSheetVM.open(task.id);
}

/** A stacked card drags from its body; a click without movement still opens the task. */
function startPoolDrag(event: PointerEvent, task: Task): void {
  if (event.button !== 0) return;
  poolDrag.start(event, task.id);
}

function openLater(task: Task): void {
  if (poolDragged.value) {
    poolDragged.value = false;
    return;
  }
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  void taskSheetVM.open(task.id);
}

/** The day a stacked task waits for, e.g. "11/9 周一 起". */
function laterStart(task: Task): string {
  const start = task.expectedStartDate;
  return start
    ? t("week.laterStarts", { date: shortDate(start), weekday: weekdayLabel(start) })
    : "";
}

function refresh(): void {
  void load();
}
</script>

<template>
  <section class="space-y-2" :class="{ 'flex grow flex-col': ganttView }">
    <div v-if="passNeeded" class="flex items-center gap-3 rounded-xl bg-base-100 px-4 py-2.5">
      <span class="text-[12.5px]">{{ t("week.passNeeded") }}</span>
      <span class="text-[11px] text-base-content/45">{{
        t("week.pending", { count: state.tasks.length })
      }}</span>
      <button
        class="btn btn-sm ml-auto rounded-lg border-0 bg-primary text-primary-content"
        @click="passVM.start"
      >
        {{ t("week.pass") }}
      </button>
    </div>

    <CaptureBar v-model="state.draft" @submit="capture" />

    <div
      v-if="planEnd"
      class="flex flex-wrap items-center gap-2 px-1 text-[10.5px] text-base-content/45"
      aria-live="polite"
    >
      <span>
        {{
          t("week.planEnd", {
            date: shortDate(planEnd),
            weekday: planEnd ? weekdayLabel(planEnd) : "",
          })
        }}
      </span>
      <span v-if="conflictCount" class="badge badge-soft badge-error badge-xs">
        {{ t("week.conflict", { count: conflictCount }) }}
      </span>
      <span v-if="overloadDates.length" class="badge badge-soft badge-warning badge-xs">
        {{ t("week.overloaded", { dates: overloadText }) }}
      </span>
    </div>

    <p
      v-if="emptyWeek && !(ganttView && laterTasks.length)"
      class="px-1 text-[13px] text-base-content/40"
    >
      {{ t("week.empty") }}
    </p>

    <WeekGantt
      v-else-if="ganttView && (lanes.length || laterTasks.length)"
      :lanes="lanes"
      :dates="week"
      :outside-moved="poolMoved"
      :outside-column="poolColumn"
      :outside-before="poolTarget?.beforeId ?? null"
      @changed="refresh"
    />

    <div v-if="!ganttView && shownDays.length" ref="listEl" :class="{ 'select-none': draggingId }">
      <section
        v-for="day in shownDays"
        :key="day.date"
        :data-day="day.date"
        :class="{ 'opacity-75': day.isPast }"
      >
        <div class="flex items-center gap-2 px-1 pt-1.5 pb-1 text-[10.5px] text-base-content/40">
          <span class="font-medium">{{ day.weekday }}</span>
          <span>{{ shortDate(day.date) }}</span>
          <span v-if="day.isToday" class="badge badge-soft badge-primary badge-xs">{{
            t("week.today")
          }}</span>
          <span v-else-if="day.isPast" class="badge badge-ghost badge-xs">{{
            t("week.past")
          }}</span>
          <span v-if="dayLoad(day.date)" class="ml-auto text-[10px] text-base-content/40">
            {{ t("week.dayLoad", { hours: dayLoad(day.date) }) }}
          </span>
          <span
            v-if="dragMoved && dropTarget?.day === day.date"
            class="text-[10px] text-primary"
            :class="{ 'ml-auto': !dayLoad(day.date) }"
          >
            {{ t("week.dropDay") }}
          </span>
        </div>
        <AnimatePresence as="ul" mode="popLayout" :initial="false" class="space-y-1.5">
          <TaskRow
            v-for="row in day.rows"
            :key="row.task.id"
            :task="row.task"
            :readonly="row.history === true"
            :plan="{
              start: row.start,
              end: row.end,
              spans: row.spans,
              days: row.days,
              clamped: row.clamped,
              conflict: row.conflict,
            }"
            :data-task-id="row.history ? undefined : row.task.id"
            :drop-line="
              dragMoved &&
              dropTarget?.day === day.date &&
              dropTarget.beforeId === row.task.id &&
              draggingId !== row.task.id
            "
            :style="{ opacity: draggingId === row.task.id ? 0.4 : undefined }"
            @open="openTask"
            @changed="refresh"
          >
            <template v-if="!row.history" #leading>
              <button
                class="shrink-0 cursor-grab touch-none text-base-content/25 hover:text-base-content/60"
                :aria-label="t('week.reorderAria', { title: row.task.title })"
                @click.stop
                @pointerdown="startDrag($event, row.task.id)"
                @pointermove="drag.move"
                @pointerup="drag.end"
                @pointercancel="drag.cancel"
                @keydown.up.prevent="onMoveBy(row.task.id, -1)"
                @keydown.down.prevent="onMoveBy(row.task.id, 1)"
              >
                <GripVertical :size="14" aria-hidden="true" />
              </button>
            </template>
          </TaskRow>
        </AnimatePresence>
        <div
          v-if="!day.rows.length"
          class="mt-0.5 flex h-9 items-center justify-center rounded-xl border border-dashed text-[10.5px]"
          :class="
            dragMoved && dropTarget?.day === day.date
              ? 'border-primary/60 bg-primary/5 text-primary'
              : 'border-base-content/15 text-base-content/30'
          "
        >
          {{ dragMoved ? t("week.dropDay") : t("week.emptyDay") }}
        </div>
        <div
          v-else-if="dragMoved && dropTarget?.day === day.date && dropTarget.beforeId === null"
          class="mt-1.5 h-6 rounded-xl border border-dashed border-primary/50"
        ></div>
      </section>
    </div>

    <div v-if="suspendedOpen" class="space-y-1.5">
      <div class="px-1 text-[10.5px] font-medium tracking-wide text-base-content/40">
        {{ t("week.suspended", { count: state.suspended.length }) }}
      </div>
      <ul class="space-y-1.5">
        <TaskRow
          v-for="task in state.suspended"
          :key="task.id"
          :task="task"
          :style="{ opacity: draggingId === task.id ? 0.4 : undefined }"
          @open="openTask"
          @changed="refresh"
        >
          <template v-if="!ganttView" #leading>
            <button
              class="shrink-0 cursor-grab touch-none text-base-content/25 hover:text-base-content/60"
              :aria-label="t('week.reorderAria', { title: task.title })"
              @click.stop
              @pointerdown="startDrag($event, task.id)"
              @pointermove="drag.move"
              @pointerup="drag.end"
              @pointercancel="drag.cancel"
            >
              <GripVertical :size="14" aria-hidden="true" />
            </button>
          </template>
          <template #actions>
            <button
              class="grid h-5 place-items-center rounded-md px-1 text-[10.5px] text-primary hover:bg-base-200"
              @click.stop="resume(task.id)"
            >
              {{ t("week.resume") }}
            </button>
          </template>
        </TaskRow>
      </ul>
    </div>

    <div v-if="laterTasks.length" class="week-later space-y-1.5 px-1">
      <div
        class="flex items-center gap-2 px-1 text-[10.5px] font-medium tracking-wide text-base-content/40"
      >
        <span>{{ t("week.later", { count: laterTasks.length }) }}</span>
        <span class="ml-auto text-[10px]">{{ t("week.laterHint") }}</span>
      </div>
      <ul class="flex items-end overflow-x-auto pt-14 pb-1">
        <li
          v-for="task in laterTasks"
          :key="task.id"
          class="week-later-card relative -ml-[156px] flex h-[66px] w-[260px] shrink-0 cursor-grab touch-none flex-col justify-center gap-1 rounded-xl border border-base-300 bg-base-100 px-3 py-2 shadow-sm transition duration-200 ease-out first:ml-0 hover:-translate-y-[34px] hover:border-primary/50 hover:shadow-lg focus-visible:ring-2 focus-visible:ring-primary/40 after:absolute after:inset-x-0 after:top-full after:h-12 after:content-['']"
          :class="{ 'opacity-40': poolDraggingId === task.id }"
          role="button"
          tabindex="0"
          :aria-label="t('week.laterCardAria', { title: task.title })"
          @pointerdown="startPoolDrag($event, task)"
          @pointermove="poolDrag.move"
          @pointerup="poolDrag.end"
          @pointercancel="poolDrag.cancel"
          @click="openLater(task)"
          @keydown.enter.prevent="openLater(task)"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <StatusDot :status="task.status" :suspended="task.suspended" />
            <span class="truncate text-[13px]">{{ task.title }}</span>
            <span
              v-if="task.projectName"
              class="badge badge-soft badge-primary badge-xs max-w-16 shrink-0"
              :title="task.projectName"
            >
              <span class="min-w-0 truncate">{{ task.projectName }}</span>
            </span>
          </span>
          <span class="flex min-w-0 items-center gap-1.5 text-[10.5px] text-base-content/45">
            <span class="truncate">{{ laterStart(task) }}</span>
            <span v-if="task.effortMinutes !== 480" class="badge badge-ghost badge-xs shrink-0">
              {{ formatEffort(task.effortMinutes) }}
            </span>
          </span>
        </li>
      </ul>
    </div>

    <div class="flex items-center gap-3 px-1 text-[11px] text-base-content/45">
      <span class="tabular-nums">
        {{
          t("week.stats", {
            done: state.stats.done,
            added: state.stats.added,
            delayed: state.stats.delayed,
          })
        }}
      </span>
    </div>

    <AnimatePresence>
      <TaskSheet v-if="taskSheetVM.state.openId" />
    </AnimatePresence>
    <AnimatePresence>
      <WeeklyPass v-if="passVM.state.open" />
    </AnimatePresence>
  </section>
</template>

<script setup lang="ts">
import { GripVertical } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { shortDate, todayIso, weekWorkdays, weekdayLabel } from "../lib/dates";
import { askNotice } from "../lib/dialog";
import { formatEffort } from "../lib/effort";
import { errorText, t } from "../lib/i18n";
import { easeOut, springSnappy, weekViewMotion } from "../lib/motion";
import { fillPlannedDays } from "../lib/plan";
import { usePointerDrag } from "../lib/pointerDrag";
import { isRuleTask } from "../lib/rules";
import { LOAD_WARN_HOURS } from "../lib/schedule";
import { prefersReducedMotion } from "../lib/windowMotion";
import ViewSwitch from "./components/ViewSwitch.vue";
import { anchorFor, coveredDays, ganttDropAt, listDropAt } from "../lib/weekDrop";
import { overdueDays } from "../model/mappers";
import type { Task, WeekView } from "../model/types";
import { appVM } from "../viewmodels/appVM";
import { usePageHeader } from "../viewmodels/pageHeaderVM";
import { passVM } from "../viewmodels/passVM";
import { settingsVM } from "../viewmodels/settingsVM";
import { taskCreateVM } from "../viewmodels/taskCreateVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { undoVM } from "../viewmodels/undoVM";
import { weekVM } from "../viewmodels/weekVM";
import CaptureBar from "./components/CaptureBar.vue";
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
  days,
  plan,
  loads,
  planEnd,
  overloadDates,
  conflictCount,
  passNeeded,
  reload,
  markSeen,
  capture,
  move,
  place,
  moveBy,
} = weekVM;
const overloadText = computed(() => overloadDates.value.map((date) => shortDate(date)).join(" · "));
const weekView = computed(() => appVM.state.settings?.weekView ?? "list");
const ganttView = computed(() => weekView.value === "gantt");
const weekViewOptions = computed<{ value: WeekView; label: string }[]>(() => [
  { value: "list", label: t("settings.weekViewList") },
  { value: "gantt", label: t("settings.weekViewGantt") },
]);
async function saveWeekView(next: string): Promise<void> {
  const ok = await settingsVM.save({ weekView: next as WeekView });
  if (!ok) void askNotice(t("common.actionFailed"), errorText(settingsVM.state.error));
}
/** The two views trade places sideways: the gantt lives right of the list. */
const reducedMotion = prefersReducedMotion();
const listSwap = reducedMotion ? {} : weekViewMotion(-1);
const ganttSwap = reducedMotion ? {} : weekViewMotion(1);

const listEl = ref<HTMLElement | null>(null);

/** The element a drag scrolls while the pointer nears an edge, in either view. */
function dragScroller(): HTMLElement | null {
  return (
    (ganttView.value
      ? document.querySelector<HTMLElement>("[data-gantt-grid]")
      : listEl.value
    )?.closest("main") ?? null
  );
}

/**
 * Where a pointer lands: a day block in the list, a column in the gantt. Both drags go
 * through this one rule, so a row and a stacked card always agree on the spot.
 */
function dropTargetAt(x: number, y: number): { day: string; beforeId: string | null } | null {
  if (!ganttView.value) return listDropAt(listEl.value, y);
  const grid = document.querySelector<HTMLElement>("[data-gantt-grid]");
  if (!grid) return null;
  // The stack sits below the grid, so only a pointer inside it reads as a day.
  const box = grid.getBoundingClientRect();
  if (y < box.top || y >= box.bottom) return null;
  const drop = ganttDropAt(grid, x, y, week.value.length);
  return drop ? { day: week.value[drop.column], beforeId: drop.before } : null;
}

/** The list's drag: threshold, the day and row under the pointer, edge auto-scroll. */
const drag = usePointerDrag<{ day: string; beforeId: string | null }>({
  targetOf: ({ x, y }) => dropTargetAt(x, y),
  scroller: dragScroller,
  drop: (id, target) => {
    // The anchor is read while the drag still counts as live: a parked drag may have
    // filled days that disappear again as soon as it ends.
    const beforeId = anchorFor(shownDays.value, target.day, target.beforeId);
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
  // The stack drops through the same rule the rows do, so a card lands where a row would.
  targetOf: ({ x, y }) => dropTargetAt(x, y),
  scroller: dragScroller,
  drop: (id, target) => {
    const beforeId = ganttView.value
      ? target.beforeId
      : anchorFor(shownDays.value, target.day, target.beforeId);
    void place(id, target.day, beforeId);
  },
  onRelease: (moved) => {
    // A drag ends with a click, even one released outside every day.
    if (!moved) return;
    poolDragged.value = true;
    window.setTimeout(() => (poolDragged.value = false), 0);
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
/** The rail's cards: laid out vertically, so the FLIP layout animation is the movement. */
function laterMotion(dimmed: boolean) {
  return {
    layout: true,
    initial: false,
    animate: { opacity: dimmed ? 0.4 : 1 },
    exit: { opacity: 0, transition: { duration: 0.12, ease: easeOut } },
    transition: springSnappy,
  };
}

/** The card under the pointer while dragging it out of the stack. */
const poolGhost = reactive({ task: null as Task | null, x: 0, y: 0, over: false });
const poolDropLabel = computed(() => {
  const day = poolTarget.value?.day;
  return day
    ? t("week.dropTo", { date: shortDate(day), weekday: weekdayLabel(day) })
    : t("week.dropBack");
});
/** The title row's one number: how much of today is already booked. */
const todayLoad = computed(() => loads.value.get(today.value) ?? 0);
/** Work that already missed its day; parked tasks are not chased. */
const overdueCount = computed(
  () =>
    weekTasks.value.filter(
      (task) =>
        task.status !== "done" &&
        !task.parked &&
        overdueDays(task.expectedFinishDate, today.value) > 0,
    ).length,
);

usePageHeader(() => ({
  title: t("nav.week"),
  context: [
    week.value.length
      ? `${shortDate(week.value[0])} – ${shortDate(week.value[week.value.length - 1])}`
      : "",
    todayLoad.value > 0
      ? `${t("common.today")} ${formatEffort(Math.round(todayLoad.value * 60))}`
      : "",
  ]
    .filter(Boolean)
    .join(" · "),
  warning: overdueCount.value ? t("week.overdueCount", { count: overdueCount.value }) : "",
  actionLabel: t("week.pass"),
  actionCount: passNeeded.value ? state.tasks.length : null,
  action: passNeeded.value ? () => void passVM.start() : null,
}));

const draggingId = computed(() => drag.id.value ?? poolDrag.id.value);
const dropTarget = computed(() => drag.target.value ?? poolDrag.target.value);
const dragMoved = computed(() => drag.moved.value || poolDrag.moved.value);

const draggingSuspended = computed(
  () => draggingId.value !== null && state.parked.some((task) => task.id === draggingId.value),
);
/**
 * A parked task still needs somewhere to land. With the empty-day setting off the list
 * can be empty, so a parked drag temporarily fills this week's workdays back in.
 */
const shownDays = computed(() => {
  if (days.value.length || !(draggingSuspended.value || poolMoved.value)) return days.value;
  const today = todayIso();
  return fillPlannedDays(days.value, weekWorkdays(today), plan.value, today);
});
/** Nothing to show: the list's empty days and the board's empty panels are the two cases. */
const emptyWeek = computed(() => {
  if (state.loading || weekTasks.value.length) return false;
  return ganttView.value ? !days.value.some((day) => day.rows.length) : !shownDays.value.length;
});
/** The days each open task already shows on, so a drop inside them only reorders. */
const plannedDays = computed(() => coveredDays(shownDays.value));

/** The handle starts the drag; a right click does not. */
function startDrag(event: PointerEvent, id: string): void {
  if (event.button !== 0) return;
  drag.start(event, id);
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
  cancelPoolDrag();
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
  reload();
  void markSeen();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("focus", onWindowFocus);
  reload();
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
      reload();
    }
  },
);

watch(
  () => taskSheetVM.state.openId,
  (open) => {
    if (!open) reload();
  },
);

// A reload changes how many cards the row holds: re-measure once the DOM has them.

function dayLoad(date: string): number {
  return loads.value.get(date) ?? 0;
}

function openTask(task: Task): void {
  void taskSheetVM.open(task.id);
}

/** A stacked card drags from its body; a click without movement still opens the task. */
function startPoolDrag(event: PointerEvent, task: Task): void {
  if (event.button !== 0) return;
  // Holding a card must not start a text selection in the page behind it.
  event.preventDefault();
  poolGhost.task = task;
  poolGhost.x = event.clientX;
  poolGhost.y = event.clientY;
  poolGhost.over = false;
  poolDrag.start(event, task.id);
}

/** The card follows the pointer; the target day puts a hint in its second line. */
function movePoolDrag(event: PointerEvent): void {
  poolDrag.move(event);
  if (!poolDraggingId.value) return;
  poolGhost.x = event.clientX;
  poolGhost.y = event.clientY;
  poolGhost.over = poolDrag.moved.value && poolTarget.value !== null;
}

function endPoolDrag(): void {
  poolDrag.end();
  poolGhost.task = null;
  poolGhost.over = false;
}

function cancelPoolDrag(): void {
  poolDrag.cancel();
  poolGhost.task = null;
  poolGhost.over = false;
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
  reload();
}
watch(
  () => undoVM.state.revision,
  () => {
    weekVM.reload();
  },
);
</script>

<template>
  <section class="flex grow flex-col gap-3" :class="{ 'select-none': draggingId }">
    <CaptureBar v-model="state.draft" add @submit="capture" @add="taskCreateVM.open()" />

    <div
      class="grid grid-cols-1 gap-[18px] min-[1320px]:grid-cols-[minmax(0,1fr)_320px] min-[1320px]:items-start"
    >
      <div class="min-w-0">
        <div class="flex min-h-[30px] items-center gap-2 px-0.5">
          <div
            v-if="planEnd"
            class="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-base-content/65"
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
            <span v-if="conflictCount" class="text-error">
              {{ t("week.conflict", { count: conflictCount }) }}
            </span>
            <span v-if="overloadDates.length" class="text-warning">
              {{ t("week.overloaded", { dates: overloadText }) }}
            </span>
          </div>
          <ViewSwitch
            class="ml-auto"
            :label="t('settings.weekView')"
            :options="weekViewOptions"
            :model-value="weekView"
            @update:model-value="saveWeekView"
          />
        </div>

        <AnimatePresence mode="wait" :initial="false">
          <motion.div
            v-if="ganttView && (days.some((day) => day.rows.length) || laterTasks.length)"
            key="gantt"
            v-bind="ganttSwap"
            class="flex grow flex-col"
          >
            <WeekGantt
              :days="days"
              :dates="week"
              :today="today"
              :outside-moved="poolMoved"
              :outside-column="poolColumn"
              :outside-before="poolTarget?.beforeId ?? null"
              @changed="refresh"
            />
          </motion.div>

          <motion.div v-else key="list" v-bind="listSwap">
            <p
              v-if="emptyWeek && !(ganttView && laterTasks.length)"
              class="px-1 pb-2 text-[13px] text-base-content/65"
            >
              {{ t("week.empty") }}
            </p>

            <div
              v-if="!ganttView && shownDays.length"
              ref="listEl"
              :class="{ 'select-none': draggingId }"
            >
              <section
                v-for="day in shownDays"
                :key="day.date"
                :data-day="day.date"
                class="mb-3.5 last:mb-0"
              >
                <div class="flex h-[30px] items-center gap-2 px-0.5">
                  <span
                    class="text-[13px] font-semibold"
                    :class="{ 'text-primary': day.isToday }"
                    >{{ day.weekday }}</span
                  >
                  <span
                    class="text-[12px]"
                    :class="day.isToday ? 'text-primary/80' : 'text-base-content/65'"
                    >{{ shortDate(day.date) }}</span
                  >
                  <span v-if="day.isToday" class="badge badge-primary badge-xs">{{
                    t("week.today")
                  }}</span>
                  <span v-else-if="day.isPast" class="text-[12px] text-base-content/60">{{
                    t("week.past")
                  }}</span>
                  <span
                    v-if="dragMoved && dropTarget?.day === day.date"
                    class="text-[11.5px] text-primary"
                  >
                    {{ t("week.dropDay") }}
                  </span>
                  <span
                    v-if="dayLoad(day.date)"
                    class="ml-auto flex items-center gap-2 tabular-nums text-[11.5px] text-base-content/65"
                    :class="{ 'text-error': dayLoad(day.date) > LOAD_WARN_HOURS }"
                  >
                    <span>{{ formatEffort(Math.round(dayLoad(day.date) * 60)) }}</span>
                    <span class="h-1 w-14 overflow-hidden rounded-full bg-base-300">
                      <span
                        class="block h-full rounded-full"
                        :class="dayLoad(day.date) > LOAD_WARN_HOURS ? 'bg-error' : 'bg-primary'"
                        :style="{ width: `${Math.min(100, (dayLoad(day.date) / 8) * 100)}%` }"
                      ></span>
                    </span>
                  </span>
                </div>
                <div
                  class="overflow-hidden rounded-lg"
                  :class="day.isToday ? 'bg-primary/[0.06]' : 'bg-base-100'"
                >
                  <AnimatePresence
                    as="ul"
                    mode="popLayout"
                    :initial="false"
                    class="divide-y divide-base-200"
                  >
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
                      :dimmed="draggingId === row.task.id"
                      @open="openTask"
                      @changed="refresh"
                    >
                      <template v-if="!row.history && !isRuleTask(row.task)" #leading>
                        <button
                          type="button"
                          class="cursor-grab touch-none text-base-content/25 hover:text-base-content/60"
                          :aria-label="t('week.reorderAria', { title: row.task.title })"
                          @click.stop
                          @pointerdown="startDrag($event, row.task.id)"
                          @pointermove="drag.move"
                          @pointerup="drag.end"
                          @pointercancel="drag.cancel"
                          @keydown.up.prevent="onMoveBy(row.task.id, -1)"
                          @keydown.down.prevent="onMoveBy(row.task.id, 1)"
                        >
                          <GripVertical :size="13" aria-hidden="true" />
                        </button>
                      </template>
                    </TaskRow>
                  </AnimatePresence>
                  <div
                    v-if="!day.rows.length"
                    class="flex h-11 items-center px-3 text-[12px]"
                    :class="
                      dragMoved && dropTarget?.day === day.date
                        ? 'bg-primary/5 text-primary'
                        : 'text-base-content/55'
                    "
                  >
                    {{ dragMoved ? t("week.dropDay") : t("week.emptyDay") }}
                  </div>
                  <div
                    v-else-if="
                      dragMoved && dropTarget?.day === day.date && dropTarget.beforeId === null
                    "
                    class="h-1.5 bg-primary/25"
                  ></div>
                </div>
              </section>
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      <aside
        class="grid min-w-0 grid-cols-1 gap-5 min-[1000px]:grid-cols-3 min-[1320px]:flex min-[1320px]:flex-col"
      >
        <div
          class="grid grid-cols-3 gap-2 rounded-lg bg-base-100 px-3.5 py-3 min-[1000px]:col-span-3 min-[1320px]:col-span-1"
        >
          <div>
            <div class="text-[11.5px] text-base-content/65">{{ t("stats.completed") }}</div>
            <div class="mt-0.5 text-[20px] font-medium tabular-nums">{{ state.stats.done }}</div>
          </div>
          <div>
            <div class="text-[11.5px] text-base-content/65">{{ t("stats.trendCreated") }}</div>
            <div class="mt-0.5 text-[20px] font-medium tabular-nums">{{ state.stats.added }}</div>
          </div>
          <div>
            <div class="text-[11.5px] text-base-content/65">{{ t("stats.delayed") }}</div>
            <div class="mt-0.5 text-[20px] font-medium tabular-nums">{{ state.stats.delayed }}</div>
          </div>
        </div>

        <section v-if="laterTasks.length" class="min-w-0">
          <div class="mb-2 flex items-baseline gap-2">
            <h2 class="text-[14px] font-semibold">
              {{ t("week.later", { count: laterTasks.length }) }}
            </h2>
            <span class="ml-auto truncate text-[11.5px] text-base-content/55">{{
              t("week.laterHint")
            }}</span>
          </div>
          <ul class="week-later overflow-hidden rounded-lg bg-base-100">
            <AnimatePresence mode="popLayout" :initial="false">
              <motion.li
                v-for="task in laterTasks"
                :key="task.id"
                v-bind="laterMotion(poolDraggingId === task.id)"
                class="relative cursor-grab touch-none px-3 py-2.5 select-none transition-colors hover:bg-base-200/60 focus-visible:ring-2 focus-visible:ring-primary/40 [&+&]:border-t [&+&]:border-base-200"
                role="button"
                tabindex="0"
                :aria-label="t('week.laterCardAria', { title: task.title })"
                @pointerdown="startPoolDrag($event, task)"
                @pointermove="movePoolDrag"
                @pointerup="endPoolDrag"
                @pointercancel="cancelPoolDrag"
                @click="openLater(task)"
                @keydown.enter.prevent="openLater(task)"
              >
                <div class="flex min-w-0 items-center gap-2">
                  <span class="truncate text-[13px]">{{ task.title }}</span>
                  <span
                    v-if="task.projectName"
                    class="ml-auto max-w-24 shrink-0 truncate rounded border border-base-300 px-1.5 py-px text-[11px] text-base-content/70"
                    :title="task.projectName"
                  >
                    {{ task.projectName }}
                  </span>
                </div>
                <div class="mt-0.5 flex items-center gap-2 text-[11.5px] text-base-content/65">
                  <span class="truncate">{{ laterStart(task) }}</span>
                  <span v-if="task.effortMinutes !== 480" class="shrink-0">{{
                    formatEffort(task.effortMinutes)
                  }}</span>
                </div>
              </motion.li>
            </AnimatePresence>
          </ul>
        </section>
      </aside>
    </div>

    <AnimatePresence>
      <TaskSheet v-if="taskSheetVM.state.openId" key="task-sheet" />
    </AnimatePresence>
    <AnimatePresence>
      <WeeklyPass v-if="passVM.state.open" />
    </AnimatePresence>

    <div
      v-if="poolGhost.task && poolMoved"
      class="pointer-events-none fixed z-50 flex w-[260px] select-none flex-col justify-center gap-1 rounded-lg border bg-base-100 px-3 py-2 shadow-lg"
      :class="poolGhost.over ? 'border-primary/60' : 'border-base-300 opacity-80'"
      :style="{
        transform: `translate3d(${poolGhost.x - 130}px, ${poolGhost.y - 40}px, 0)`,
      }"
      aria-hidden="true"
    >
      <span class="flex min-w-0 items-center gap-1.5">
        <span class="truncate text-[13px]">{{ poolGhost.task.title }}</span>
      </span>
      <span
        class="truncate text-[11.5px]"
        :class="poolGhost.over ? 'text-primary' : 'text-base-content/55'"
      >
        {{ poolDropLabel }}
      </span>
    </div>
  </section>
</template>

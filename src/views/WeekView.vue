<script setup lang="ts">
import { GripVertical } from "@lucide/vue";
import { AnimatePresence } from "motion-v";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { remainingWorkdays, shortDate, todayIso, weekdayLabel } from "../lib/dates";
import { t } from "../lib/i18n";
import { fillPlannedDays } from "../lib/plan";
import type { Task } from "../model/types";
import { appVM } from "../viewmodels/appVM";
import { passVM } from "../viewmodels/passVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { weekVM } from "../viewmodels/weekVM";
import CaptureBar from "./components/CaptureBar.vue";
import TaskContinuation from "./components/TaskContinuation.vue";
import TaskRow from "./components/TaskRow.vue";
import TaskSheet from "./overlays/TaskSheet.vue";
import WeeklyPass from "./overlays/WeeklyPass.vue";

const {
  state,
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

const listEl = ref<HTMLElement | null>(null);
const draggingId = ref<string | null>(null);
const dropTarget = ref<{ day: string; beforeId: string | null } | null>(null);
const dragMoved = ref(false);
let startY = 0;
let pointerY = 0;
let scrollFrame = 0;

/** The day the planner starts each in-week task on, so a drop inside it only reorders. */
const plannedDay = computed(() => new Map(plan.value.map((row) => [row.id, row.start])));
const draggingSuspended = computed(
  () => draggingId.value !== null && state.suspended.some((task) => task.id === draggingId.value),
);
/**
 * A parked task still needs somewhere to land. With the empty-day setting off the list
 * can be empty, so a suspended drag temporarily fills this week's workdays back in.
 */
const shownDays = computed(() => {
  if (days.value.length || !draggingSuspended.value) return days.value;
  const today = todayIso();
  return fillPlannedDays(days.value, remainingWorkdays(today), plan.value, today);
});

function onHandleDown(event: PointerEvent, id: string): void {
  if (event.button !== 0) return;
  draggingId.value = id;
  dropTarget.value = null;
  dragMoved.value = false;
  startY = event.clientY;
  pointerY = event.clientY;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

/** Finds the day under the pointer, then the row inside it to insert before. */
function updateDropTarget(): void {
  const sections = listEl.value?.querySelectorAll<HTMLElement>("[data-day]");
  if (!sections?.length) return;
  let section: HTMLElement | null = null;
  for (const candidate of sections) {
    const rect = candidate.getBoundingClientRect();
    if (pointerY < rect.bottom) {
      section = candidate;
      break;
    }
  }
  const day = section?.dataset.day;
  if (!section || !day) {
    dropTarget.value = null;
    return;
  }
  let beforeId: string | null = null;
  for (const row of section.querySelectorAll<HTMLElement>("[data-task-id]")) {
    const rect = row.getBoundingClientRect();
    if (pointerY < rect.top + rect.height / 2) {
      beforeId = row.dataset.taskId ?? null;
      break;
    }
  }
  dropTarget.value = { day, beforeId };
}

/** Dragging to a window edge keeps scrolling, so rows that are off-screen stay reachable. */
function autoScroll(): void {
  if (!draggingId.value) {
    scrollFrame = 0;
    return;
  }
  const edge = 56;
  const delta = pointerY < edge ? -12 : pointerY > window.innerHeight - edge ? 12 : 0;
  const scroller = listEl.value?.closest<HTMLElement>("main");
  if (!delta || !scroller) {
    scrollFrame = 0;
    return;
  }
  const before = scroller.scrollTop;
  scroller.scrollBy(0, delta);
  if (scroller.scrollTop !== before) updateDropTarget();
  scrollFrame = requestAnimationFrame(autoScroll);
}

function onHandleMove(event: PointerEvent): void {
  if (!draggingId.value) return;
  pointerY = event.clientY;
  if (!dragMoved.value && Math.abs(event.clientY - startY) < 4) return;
  dragMoved.value = true;
  updateDropTarget();
  if (!scrollFrame) scrollFrame = requestAnimationFrame(autoScroll);
}

function endDrag(): void {
  if (scrollFrame) cancelAnimationFrame(scrollFrame);
  scrollFrame = 0;
  draggingId.value = null;
  dropTarget.value = null;
  dragMoved.value = false;
}

/**
 * The global anchor for a day-local drop: the first task of a later day when the drop
 * lands after the day's last row, so `move_task` leaves it at the bottom of that day.
 */
function anchorFor(day: string, beforeId: string | null): string | null {
  if (beforeId) return beforeId;
  const index = shownDays.value.findIndex((entry) => entry.date === day);
  for (const later of shownDays.value.slice(index + 1)) {
    const first = later.rows[0];
    if (first) return first.task.id;
  }
  return null;
}

function onHandleUp(): void {
  const id = draggingId.value;
  const moved = dragMoved.value;
  const target = dropTarget.value;
  // The anchor is read while the drag is still live: a suspended drag may have filled
  // days that disappear again as soon as the drag ends.
  const beforeId = target ? anchorFor(target.day, target.beforeId) : null;
  endDrag();
  if (!id || !moved || !target) return;
  if (plannedDay.value.get(id) === target.day) void move(id, beforeId);
  else void place(id, target.day, beforeId);
}

/** Keyboard reordering keeps focus on the same handle, even across a day boundary. */
async function onMoveBy(taskId: string, delta: -1 | 1): Promise<void> {
  await moveBy(taskId, delta);
  await nextTick();
  listEl.value?.querySelector<HTMLElement>(`[data-task-id="${taskId}"] button`)?.focus();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape" && draggingId.value) endDrag();
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
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("focus", onWindowFocus);
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

function refresh(): void {
  void load();
}
</script>

<template>
  <section class="space-y-2">
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
      v-if="!state.tasks.length && !shownDays.length && !state.loading"
      class="px-1 text-[13px] text-base-content/40"
    >
      {{ t("week.empty") }}
    </p>

    <div v-if="shownDays.length" ref="listEl" :class="{ 'select-none': draggingId }">
      <section v-for="day in shownDays" :key="day.date" :data-day="day.date">
        <div class="flex items-center gap-2 px-1 pt-1.5 pb-1 text-[10.5px] text-base-content/40">
          <span class="font-medium">{{ day.weekday }}</span>
          <span>{{ shortDate(day.date) }}</span>
          <span v-if="day.isToday" class="badge badge-soft badge-primary badge-xs">{{
            t("week.today")
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
        <div v-if="day.spans.length" class="mb-1.5 space-y-1.5">
          <TaskContinuation
            v-for="span in day.spans"
            :key="span.task.id"
            :task="span.task"
            :day="span.day"
            :total="span.total"
            :hours="span.hours"
            :end="span.end"
            @open="openTask"
          />
        </div>
        <AnimatePresence as="ul" mode="popLayout" :initial="false" class="space-y-1.5">
          <TaskRow
            v-for="row in day.rows"
            :key="row.task.id"
            :task="row.task"
            :plan="{ end: row.end, spans: row.spans, days: row.days, conflict: row.conflict }"
            :drop-line="
              dragMoved &&
              dropTarget?.day === day.date &&
              dropTarget.beforeId === row.task.id &&
              draggingId !== row.task.id
            "
            :style="{ opacity: draggingId === row.task.id ? 0.4 : undefined }"
            :data-task-id="row.task.id"
            @open="openTask"
            @changed="refresh"
          >
            <template #leading>
              <button
                class="shrink-0 cursor-grab touch-none text-base-content/25 hover:text-base-content/60"
                :aria-label="t('week.reorderAria', { title: row.task.title })"
                @click.stop
                @pointerdown="onHandleDown($event, row.task.id)"
                @pointermove="onHandleMove"
                @pointerup="onHandleUp"
                @pointercancel="endDrag"
                @keydown.up.prevent="onMoveBy(row.task.id, -1)"
                @keydown.down.prevent="onMoveBy(row.task.id, 1)"
              >
                <GripVertical :size="14" aria-hidden="true" />
              </button>
            </template>
          </TaskRow>
        </AnimatePresence>
        <div
          v-if="!day.rows.length && (dragMoved || !day.spans.length)"
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
          <template #leading>
            <button
              class="shrink-0 cursor-grab touch-none text-base-content/25 hover:text-base-content/60"
              :aria-label="t('week.reorderAria', { title: task.title })"
              @click.stop
              @pointerdown="onHandleDown($event, task.id)"
              @pointermove="onHandleMove"
              @pointerup="onHandleUp"
              @pointercancel="endDrag"
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

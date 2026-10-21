<script setup lang="ts">
import { GripVertical } from "@lucide/vue";
import { AnimatePresence } from "motion-v";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { shortDate, weekdayLabel } from "../lib/dates";
import type { Task } from "../model/types";
import { appVM } from "../viewmodels/appVM";
import { passVM } from "../viewmodels/passVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { weekVM } from "../viewmodels/weekVM";
import CaptureBar from "./components/CaptureBar.vue";
import TaskRow from "./components/TaskRow.vue";
import TaskSheet from "./overlays/TaskSheet.vue";
import WeeklyPass from "./overlays/WeeklyPass.vue";

const { state, days, planEnd, conflictCount, load, capture, resume, move, moveBy } = weekVM;
const suspendedOpen = computed(() => state.suspended.length > 0);

const listEl = ref<HTMLElement | null>(null);
const draggingId = ref<string | null>(null);
const dropBeforeId = ref<string | null | undefined>(undefined);
const dragMoved = ref(false);
let startY = 0;
let pointerY = 0;
let scrollFrame = 0;

function onHandleDown(event: PointerEvent, id: string): void {
  if (event.button !== 0) return;
  draggingId.value = id;
  dropBeforeId.value = undefined;
  dragMoved.value = false;
  startY = event.clientY;
  pointerY = event.clientY;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
}

function updateDropTarget(): void {
  const rows = listEl.value?.querySelectorAll<HTMLElement>("[data-task-id]");
  if (!rows) return;
  let before: string | null = null;
  for (const row of rows) {
    const rect = row.getBoundingClientRect();
    if (pointerY < rect.top + rect.height / 2) {
      before = row.dataset.taskId ?? null;
      break;
    }
  }
  dropBeforeId.value = before;
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
  dropBeforeId.value = undefined;
  dragMoved.value = false;
}

function onHandleUp(): void {
  const id = draggingId.value;
  const moved = dragMoved.value;
  const before = dropBeforeId.value;
  endDrag();
  if (!id || !moved || before === undefined) return;
  void move(id, before);
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
  if (!draggingId.value) void load();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("focus", onWindowFocus);
  void load();
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

function openTask(task: Task): void {
  void taskSheetVM.open(task.id);
}
</script>

<template>
  <section class="space-y-2">
    <div
      v-if="appVM.state.passNeeded"
      class="flex items-center gap-3 rounded-xl bg-base-100 px-4 py-2.5"
    >
      <span class="text-[12.5px]">这一周的事还没结清</span>
      <span class="text-[11px] text-base-content/45">{{ state.tasks.length }} 件待定</span>
      <button
        class="btn btn-sm ml-auto rounded-lg border-0 bg-primary text-primary-content"
        @click="passVM.start"
      >
        过一遍
      </button>
    </div>

    <CaptureBar v-model="state.draft" @submit="capture" />

    <div
      v-if="days.length"
      class="flex items-center gap-2 px-1 text-[10.5px] text-base-content/45"
      aria-live="polite"
    >
      <span>
        按这个顺序，最晚 {{ shortDate(planEnd) }}（{{ planEnd ? weekdayLabel(planEnd) : "" }}）做完
      </span>
      <span v-if="conflictCount" class="badge badge-soft badge-error badge-xs">
        {{ conflictCount }} 件赶不上截止日
      </span>
    </div>

    <div v-if="days.length" ref="listEl" :class="{ 'select-none': draggingId }">
      <section v-for="(day, dayIndex) in days" :key="day.date">
        <div class="flex items-center gap-2 px-1 pt-1.5 pb-1 text-[10.5px] text-base-content/40">
          <span class="font-medium">{{ day.weekday }}</span>
          <span>{{ shortDate(day.date) }}</span>
          <span v-if="day.isToday" class="badge badge-soft badge-primary badge-xs">今天</span>
        </div>
        <AnimatePresence as="ul" mode="popLayout" :initial="false" class="space-y-1.5">
          <TaskRow
            v-for="row in day.rows"
            :key="row.task.id"
            :task="row.task"
            :plan="{ end: row.end, spans: row.spans, conflict: row.conflict }"
            :drop-line="dragMoved && dropBeforeId === row.task.id && draggingId !== row.task.id"
            :style="{ opacity: draggingId === row.task.id ? 0.4 : undefined }"
            :data-task-id="row.task.id"
            @open="openTask"
          >
            <template #leading>
              <button
                class="shrink-0 cursor-grab touch-none text-base-content/25 hover:text-base-content/60"
                :aria-label="`调整「${row.task.title}」的顺序，上下方向键移动`"
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
          v-if="dayIndex === days.length - 1 && dragMoved && dropBeforeId === null"
          class="mt-1.5 h-6 rounded-xl border border-dashed border-primary/50"
        ></div>
      </section>
    </div>

    <p v-else-if="!state.loading" class="px-1 text-[13px] text-base-content/40">
      这周还是空的。在上面记一句。
    </p>

    <div v-if="suspendedOpen" class="rounded-xl bg-base-100 px-3 py-2.5">
      <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">
        挂起 ({{ state.suspended.length }})
      </div>
      <div
        v-for="task in state.suspended"
        :key="task.id"
        class="mt-1.5 flex items-center gap-2 text-[12px]"
      >
        <span>{{ task.title }}</span>
        <span class="text-[10.5px] text-base-content/40">
          {{ shortDate(task.suspendedUntil) }} 再看
        </span>
        <button class="ml-auto text-[10.5px] text-primary" @click="resume(task.id)">
          捞回本周
        </button>
      </div>
    </div>

    <div class="flex items-center gap-3 px-1 text-[11px] text-base-content/45">
      <span class="tabular-nums">
        本周完成 {{ state.stats.done }} · 新增 {{ state.stats.added }} · 延期
        {{ state.stats.delayed }}
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

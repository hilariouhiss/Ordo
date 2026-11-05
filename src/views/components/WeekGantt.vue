<script setup lang="ts">
import { Pause, Play } from "@lucide/vue";
import { computed, nextTick, ref } from "vue";
import { shortDate, shortDateTime, todayIso, weekdayLabel } from "../../lib/dates";
import { askNotice, askSuspend } from "../../lib/dialog";
import { formatEffort } from "../../lib/effort";
import { errorText, t } from "../../lib/i18n";
import type { WeekLane } from "../../lib/plan";
import { usePointerDrag } from "../../lib/pointerDrag";
import { canSuspendTask } from "../../lib/status";
import type { Task } from "../../model/types";
import { taskRowVM } from "../../viewmodels/taskRowVM";
import { taskSheetVM } from "../../viewmodels/taskSheetVM";
import { weekVM } from "../../viewmodels/weekVM";
import PriorityBadge from "./PriorityBadge.vue";
import StatusDot from "./StatusDot.vue";

const props = defineProps<{ lanes: WeekLane[]; dates: string[] }>();
const emit = defineEmits<{ changed: [] }>();

/** Mark a column as today only when today really sits in the shown week. */
const today = computed(() => {
  const now = todayIso();
  return props.dates.includes(now) ? now : "";
});
const loads = weekVM.loads;
const overloads = weekVM.overloadDates;
const busy = ref(false);
const gridEl = ref<HTMLElement | null>(null);

/** The gantt's drag: threshold, the column and lane under the pointer, edge auto-scroll. */
const drag = usePointerDrag<{ column: number; before: string | null }>({
  targetOf: ({ x, y }) => {
    const grid = gridEl.value;
    if (!grid) return null;
    const box = grid.getBoundingClientRect();
    const width = box.width / props.dates.length;
    const column = Math.floor((x - box.left) / width);
    let before: string | null = null;
    for (const row of grid.querySelectorAll<HTMLElement>("[data-lane]")) {
      const rect = row.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        before = row.dataset.lane ?? null;
        break;
      }
    }
    return { column: Math.min(props.dates.length - 1, Math.max(0, column)), before };
  },
  scroller: () => gridEl.value?.closest("main") ?? null,
  drop: (id, target) => {
    // A drag ends with a click; the sheet must not open too.
    dragged.value = true;
    window.setTimeout(() => (dragged.value = false), 0);
    const lane = props.lanes.find((entry) => entry.task.id === id);
    if (!lane) return;
    const anchor = target.before && target.before !== id ? target.before : null;
    const day = props.dates[target.column];
    // Dropping on a day the task already covers only reorders, exactly like the list.
    if (props.dates.slice(lane.from, lane.to + 1).includes(day)) void weekVM.move(id, anchor);
    else void weekVM.place(id, day, anchor);
  },
});
const draggingId = drag.id;
const dragMoved = drag.moved;
const dropColumn = computed(() => drag.target.value?.column ?? null);
const dropBefore = computed(() => drag.target.value?.before ?? null);
/** A drag that just ended must not be read as a click on the bar. */
const dragged = ref(false);

const isDone = (task: Task): boolean => task.status === "done";

/** Bar skin: finished work recedes, conflict alarms, shared work is hatched. */
function barSkin(lane: WeekLane): string {
  if (isDone(lane.task)) {
    return "border-base-300 border-l-[3px] border-l-base-content/20 bg-base-300/50 text-base-content/40";
  }
  if (lane.row.conflict) {
    return "border-error/40 border-l-[3px] border-l-error bg-error/[0.10] text-error";
  }
  if (!lane.task.exclusive) {
    return "border-dashed border-secondary/50 border-l-[3px] border-l-secondary/60 bg-secondary/10 text-secondary";
  }
  return "border-primary/30 border-l-[3px] border-l-primary bg-primary/[0.12] text-primary";
}

function barStyle(lane: WeekLane): Record<string, string> {
  return { gridColumn: `${lane.from + 1} / span ${lane.to - lane.from + 1}` };
}

/** Every fact the list packs into a card, folded into the bar's second line. */
function metaOf(lane: WeekLane): string {
  const parts = [formatEffort(lane.task.effortMinutes)];
  if (lane.row.clamped) {
    parts.push(t("task.laterStart", { date: shortDate(lane.row.start) }));
  } else if (lane.row.spans) {
    parts.push(t("task.spanEnd", { days: lane.row.days, date: shortDate(lane.row.end) }));
  }
  if (lane.task.actualFinishAt) {
    parts.push(t("task.doneAt", { date: shortDateTime(lane.task.actualFinishAt) }));
  } else if (lane.row.conflict && lane.task.expectedFinishDate) {
    parts.push(`${t("task.expectedFinish")} ${shortDate(lane.task.expectedFinishDate)}`);
  }
  return parts.join(" · ");
}

const canComplete = (lane: WeekLane): boolean => !lane.row.history && !lane.task.steps.length;
const canStart = (task: Task): boolean =>
  !task.steps.length && !isDone(task) && (task.status === "todo" || task.suspended);
const doneLabel = (task: Task): string =>
  t(isDone(task) ? "task.reopenAria" : "task.doneAria", { title: task.title });

function openTask(task: Task): void {
  if (dragged.value) {
    dragged.value = false;
    return;
  }
  // Selecting the title to copy it also ends with a click; that must not open the sheet.
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  void taskSheetVM.open(task.id);
}

async function run(action: () => Promise<unknown>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await action();
    emit("changed");
  } catch (e) {
    void askNotice(t("common.actionFailed"), errorText(e));
  } finally {
    busy.value = false;
  }
}

/** Keyboard reordering keeps focus on the same bar, even after the list reloads. */
async function moveBy(id: string, delta: -1 | 1): Promise<void> {
  if (props.lanes.find((lane) => lane.task.id === id)?.row.history) return;
  await weekVM.moveBy(id, delta);
  await nextTick();
  gridEl.value?.querySelector<HTMLElement>(`[data-lane="${id}"] [role="button"]`)?.focus();
}

function complete(lane: WeekLane): void {
  if (!canComplete(lane)) return;
  void run(() => taskRowVM.toggleDone(lane.task));
}

function start(task: Task): void {
  void run(() => taskRowVM.start(task));
}

async function suspend(task: Task): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const draft = await askSuspend(t("task.suspendAria", { title: task.title }));
    if (!draft) return;
    await taskRowVM.suspend(task, draft.until || null, draft.reason || null);
    emit("changed");
  } catch (e) {
    void askNotice(t("common.actionFailed"), errorText(e));
  } finally {
    busy.value = false;
  }
}

/** The bar starts the drag; the row's own buttons and finished work do not. */
function startDrag(event: PointerEvent, lane: WeekLane): void {
  if (event.button !== 0 || lane.row.history) return;
  if ((event.target as HTMLElement).closest("button")) return;
  drag.start(event, lane.task.id);
}
</script>

<template>
  <div
    ref="gridEl"
    class="flex grow flex-col overflow-hidden rounded-2xl bg-base-100"
    :class="{ 'select-none': draggingId }"
  >
    <div
      class="flex h-[26px] items-center gap-2 border-b border-base-300/70 px-3.5 text-[10px] text-base-content/40"
    >
      <span class="font-medium text-base-content/55">{{ t("week.ganttCaption") }}</span>
      <span class="truncate">{{ t("week.ganttHint") }}</span>
    </div>
    <div class="grid grid-cols-5">
      <div
        v-for="date in dates"
        :key="date"
        class="flex flex-col justify-center gap-0.5 border-l border-base-300/80 px-3 py-1 first:border-l-0"
        :class="{ 'bg-base-200/70': date < today, 'bg-primary/[0.07]': date === today }"
      >
        <span class="flex items-center gap-1.5">
          <span class="text-[11.5px] font-medium text-base-content/55">{{
            weekdayLabel(date)
          }}</span>
          <span class="text-[11px] text-base-content/40">{{ shortDate(date) }}</span>
          <span v-if="date === today" class="badge badge-soft badge-primary badge-xs">{{
            t("week.today")
          }}</span>
        </span>
        <span class="flex items-center gap-1.5 text-[10px] text-base-content/40">
          <span v-if="date < today">{{ t("week.past") }}</span>
          <span v-if="loads.get(date)">{{
            t("week.dayLoad", { hours: loads.get(date) ?? 0 })
          }}</span>
          <span v-if="overloads.includes(date)" class="text-warning">{{ t("week.tooFull") }}</span>
        </span>
      </div>
    </div>

    <div class="relative isolate flex grow flex-col">
      <!-- The day columns run to the bottom of the card, so a short week still reads as a table. -->
      <div class="pointer-events-none absolute inset-0 -z-10 grid grid-cols-5" aria-hidden="true">
        <div
          v-for="date in dates"
          :key="date"
          class="border-l border-base-300/80 first:border-l-0"
          :class="{
            'bg-base-200/70': date < today,
            'border-x border-primary/20 bg-primary/[0.055]': date === today,
          }"
        ></div>
      </div>
      <div
        v-for="lane in lanes"
        :key="lane.task.id"
        :data-lane="lane.task.id"
        class="group flex h-12 shrink-0 border-t border-base-300/70"
        :class="{
          'shadow-[inset_0_2px_0_var(--color-primary)]':
            dragMoved && dropBefore === lane.task.id && draggingId !== lane.task.id,
        }"
      >
        <div class="relative grid flex-1 grid-cols-5">
          <div
            v-for="(date, index) in dates"
            :key="date"
            class="row-start-1"
            :class="{ 'bg-primary/[0.09]': dragMoved && dropColumn === index }"
          ></div>
          <div
            class="relative z-10 row-start-1 my-auto flex h-[38px] items-center gap-[7px] overflow-hidden rounded-[10px] border px-2.5"
            :class="[barSkin(lane), { 'opacity-40': draggingId === lane.task.id }]"
            :style="barStyle(lane)"
            role="button"
            tabindex="0"
            :aria-label="t('week.ganttBarAria', { title: lane.task.title })"
            @pointerdown="startDrag($event, lane)"
            @pointermove="drag.move"
            @pointerup="drag.end"
            @pointercancel="drag.cancel"
            @click="openTask(lane.task)"
            @keydown.enter.prevent="openTask(lane.task)"
            @keydown.space.prevent="openTask(lane.task)"
            @keydown.up.prevent="moveBy(lane.task.id, -1)"
            @keydown.down.prevent="moveBy(lane.task.id, 1)"
          >
            <span
              v-for="tick in lane.to - lane.from"
              :key="tick"
              class="pointer-events-none absolute inset-y-0 border-l border-primary/20"
              :style="{ left: `${(tick * 100) / (lane.to - lane.from + 1)}%` }"
            ></span>
            <button
              v-if="canComplete(lane)"
              class="flex shrink-0 rounded-full disabled:opacity-60"
              :aria-label="doneLabel(lane.task)"
              :title="doneLabel(lane.task)"
              :disabled="busy"
              @click.stop="complete(lane)"
            >
              <StatusDot :status="lane.task.status" :suspended="lane.task.suspended" />
            </button>
            <span v-else class="shrink-0">
              <StatusDot :status="lane.task.status" :suspended="lane.task.suspended" />
            </span>
            <div class="min-w-0 flex-1">
              <div class="flex min-w-0 items-center gap-1.5">
                <span
                  class="truncate text-[12.5px]"
                  :class="{ 'text-base-content/40 line-through': isDone(lane.task) }"
                >
                  {{ lane.task.title }}
                </span>
              </div>
              <div class="flex min-w-0 items-center gap-1 text-[10px]">
                <span
                  v-if="lane.row.conflict"
                  class="badge badge-soft badge-error badge-xs shrink-0"
                >
                  {{ t("task.notFit") }}
                </span>
                <span
                  v-if="lane.task.projectName"
                  class="badge badge-soft badge-primary badge-xs max-w-16 shrink-0"
                  :title="lane.task.projectName"
                >
                  <span class="min-w-0 truncate">{{ lane.task.projectName }}</span>
                </span>
                <PriorityBadge :priority="lane.task.priority" />
                <span
                  v-if="!lane.task.exclusive"
                  class="badge badge-ghost badge-xs shrink-0"
                  :title="t('task.sharedHint')"
                >
                  {{ t("task.shared") }}
                </span>
                <span class="min-w-0 truncate" :title="metaOf(lane)">{{ metaOf(lane) }}</span>
              </div>
            </div>
            <div
              class="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-base-100/90 px-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100"
            >
              <button
                v-if="canStart(lane.task)"
                class="grid size-5 place-items-center rounded-md hover:bg-base-100 disabled:opacity-50"
                :aria-label="t('task.startAria', { title: lane.task.title })"
                :title="t('task.startAria', { title: lane.task.title })"
                :disabled="busy"
                @click.stop="start(lane.task)"
              >
                <Play :size="12" aria-hidden="true" />
              </button>
              <button
                v-if="canSuspendTask(lane.task)"
                class="grid size-5 place-items-center rounded-md hover:bg-base-100 disabled:opacity-50"
                :aria-label="t('task.suspendAria', { title: lane.task.title })"
                :title="t('task.suspendAria', { title: lane.task.title })"
                :disabled="busy"
                @click.stop="suspend(lane.task)"
              >
                <Pause :size="12" aria-hidden="true" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

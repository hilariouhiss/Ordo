<script setup lang="ts">
import { Pause, Play } from "@lucide/vue";
import { computed, nextTick, ref } from "vue";
import { shortDate, todayIso, weekdayLabel } from "../../lib/dates";
import { askNotice, askPark } from "../../lib/dialog";
import { errorText, t } from "../../lib/i18n";
import type { PlannedDay, WeekLane } from "../../lib/plan";
import { groupLanes } from "../../lib/plan";
import { isRuleTask } from "../../lib/rules";
import { usePointerDrag, type PointerDrag } from "../../lib/pointerDrag";
import { canParkTask } from "../../lib/status";
import { parkedOnName, parkDefaults } from "../../lib/park";
import { ganttDropAt, type GanttDrop } from "../../lib/weekDrop";
import { appVM } from "../../viewmodels/appVM";
import { taskRowVM } from "../../viewmodels/taskRowVM";
import { taskSheetVM } from "../../viewmodels/taskSheetVM";
import { weekVM } from "../../viewmodels/weekVM";
import ParentBadge from "./ParentBadge.vue";
import PriorityBadge from "./PriorityBadge.vue";
import StatusDot from "./StatusDot.vue";

/**
 * The week as a gantt: one lane per task, a bar across the workdays it covers. A drag
 * across the grid sets both the day (x) and the order (y); the bottom stack drops onto
 * the same columns.
 */
const props = defineProps<{
  days: PlannedDay[];
  dates: string[];
  today: string;
  /** A card dragged in from the week's bottom stack. */
  outsideMoved?: boolean;
  outsideColumn?: number | null;
  outsideBefore?: string | null;
}>();
const emit = defineEmits<{ changed: [] }>();

const gridEl = ref<HTMLElement | null>(null);
const lanes = computed(() => groupLanes(props.days, props.dates));
const rowCount = computed(() => Math.max(0, ...lanes.value.map((lane) => lane.rowIndex + 1)));
const loads = weekVM.loads;
const overloadDates = weekVM.overloadDates;

const dragged = ref(false);
// The type is spelled out: a drag reports the lane it is over, and the lanes are read
// from the drag, so inference alone runs in a circle.
const drag: PointerDrag<GanttDrop> = usePointerDrag<GanttDrop>({
  targetOf: ({ x, y }) => ganttDropAt(gridEl.value, x, y, props.dates.length),
  scroller: () => gridEl.value?.closest("main") ?? null,
  drop: (id, target) => {
    const day = props.dates[target.column];
    if (!day) return;
    const lane = lanes.value.find((entry) => entry.task.id === id);
    // Dropping on the dragged lane itself keeps its place; the day is what changed.
    const index = lanes.value.findIndex((entry) => entry.task.id === id);
    const beforeId =
      target.before === id ? (lanes.value[index + 1]?.task.id ?? null) : target.before;
    // A parked task has no worked days of its own: any drop places it and brings it back.
    if (!lane?.task.parked && lane && props.dates.slice(lane.from, lane.to + 1).includes(day))
      void weekVM.move(id, beforeId);
    else void weekVM.place(id, day, beforeId);
  },
  onRelease: (moved) => {
    // A drag ends with a click, even one released outside every column.
    if (!moved) return;
    dragged.value = true;
    window.setTimeout(() => (dragged.value = false), 0);
  },
});
const draggingId = computed(() => drag.id.value);
const targetColumn = computed(() => drag.target.value?.column ?? props.outsideColumn ?? null);
const targetMoved = computed(() => drag.moved.value || props.outsideMoved === true);
const dropBefore = computed(() => drag.target.value?.before ?? props.outsideBefore ?? null);

function dayLoad(date: string): number {
  return loads.value.get(date) ?? 0;
}
/** The bar's grid box: its row, and the columns its days cover. */
function boxOf(lane: WeekLane): string {
  return `grid-row: ${lane.rowIndex + 1}; grid-column: ${lane.from + 1} / span ${lane.to - lane.from + 1}`;
}
const isDone = (lane: WeekLane): boolean => lane.task.status === "done";

/** Bar skin: finished work recedes, parked work warns, conflict alarms. */
function skin(lane: WeekLane): string {
  if (isDone(lane)) {
    return "border-base-300 border-l-[3px] border-l-base-content/20 bg-base-300/50 text-base-content/60";
  }
  if (lane.task.parked) {
    return "border-dashed border-warning/50 border-l-[3px] border-l-warning bg-warning/[0.10] text-warning";
  }
  if (lane.row.conflict) {
    return "border-error/40 border-l-[3px] border-l-error bg-error/[0.10] text-error";
  }
  return "border-primary/30 border-l-[3px] border-l-primary bg-primary/[0.12] text-primary";
}

/**
 * Whether the bar carries a second line at all: only the state badges make one. The
 * span, the estimate and the dates read off the bar itself and the task sheet, so the
 * gantt does not repeat them.
 */
function hasBadges(lane: WeekLane): boolean {
  return (
    lane.row.conflict ||
    lane.task.parked ||
    !!lane.task.projectName ||
    lane.task.priority !== "normal"
  );
}

const canComplete = (lane: WeekLane): boolean => !lane.row.history && !lane.task.children.length;
const canStart = (lane: WeekLane): boolean =>
  !lane.task.children.length && !isDone(lane) && (lane.task.status === "todo" || lane.task.parked);
/** A parked bar gets its way back from the start button. */
const canPark = (lane: WeekLane): boolean =>
  !lane.row.history && !lane.task.parked && canParkTask(lane.task);
const doneLabel = (lane: WeekLane): string =>
  t(isDone(lane) ? "task.reopenAria" : "task.doneAria", { title: lane.task.title });
/** The parked line: who it waits on, the day to look again, or just the state. */
const parkedLabel = (lane: WeekLane): string => {
  const name = parkedOnName(lane.task, appVM.state.people);
  if (name) return t("task.waitingOn", { name });
  if (lane.task.parkUntil) {
    return t("task.parkUntil", { date: shortDate(lane.task.parkUntil) });
  }
  return t("task.parkedNoDate");
};

const busy = ref(false);
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

function complete(lane: WeekLane): void {
  if (!canComplete(lane)) return;
  void run(() => taskRowVM.toggleDone(lane.task));
}

function start(lane: WeekLane): void {
  void run(() => taskRowVM.start(lane.task));
}

async function park(lane: WeekLane): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const draft = await askPark(t("task.suspendAria", { title: lane.task.title }), {
      reason: "",
      ...parkDefaults(lane.task, appVM.state.people, todayIso()),
    });
    if (!draft) return;
    await taskRowVM.park(lane.task, draft);
    emit("changed");
  } catch (e) {
    void askNotice(t("common.actionFailed"), errorText(e));
  } finally {
    busy.value = false;
  }
}

function openTask(lane: WeekLane): void {
  if (dragged.value) {
    dragged.value = false;
    return;
  }
  // Selecting a title to copy it also ends with a click; that must not open the sheet.
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  void taskSheetVM.open(lane.task.id);
}

function startDrag(event: PointerEvent, lane: WeekLane): void {
  if (event.button !== 0 || lane.row.history || isRuleTask(lane.task)) return;
  if ((event.target as HTMLElement).closest("button")) return;
  drag.start(event, lane.task.id);
}

async function moveBy(id: string, delta: -1 | 1): Promise<void> {
  if (lanes.value.find((lane) => lane.task.id === id)?.row.history) return;
  await weekVM.moveBy(id, delta);
  await nextTick();
  gridEl.value?.querySelector<HTMLElement>(`[data-lane="${id}"]`)?.focus();
}
</script>

<template>
  <div class="flex grow flex-col gap-1.5">
    <div class="flex h-[26px] items-center gap-2 px-0.5 text-[12px] text-base-content/60">
      <span class="font-medium text-base-content/60">{{ t("week.ganttCaption") }}</span>
      <span class="truncate">{{ t("week.ganttHint") }}</span>
    </div>

    <div
      ref="gridEl"
      data-gantt-grid
      class="flex grow flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100"
      :class="{ 'select-none': draggingId }"
    >
      <div class="grid shrink-0 grid-cols-5 border-b border-base-300/70">
        <div
          v-for="(date, index) in dates"
          :key="date"
          class="flex min-w-0 flex-col justify-center gap-0.5 border-l border-base-300/70 px-3 py-1 first:border-l-0"
          :class="{
            'bg-base-200/60': date < today,
            'bg-primary/[0.14]': date === today,
          }"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <span
              class="text-[12px] font-medium"
              :class="
                date === today
                  ? 'text-primary'
                  : date < today
                    ? 'text-base-content/60'
                    : 'text-base-content/60'
              "
              >{{ weekdayLabel(date) }}</span
            >
            <span
              class="text-[12px]"
              :class="
                date === today
                  ? 'text-primary/80'
                  : date < today
                    ? 'text-base-content/60'
                    : 'text-base-content/60'
              "
              >{{ shortDate(date) }}</span
            >
            <span v-if="date === today" class="badge badge-primary badge-xs">{{
              t("week.today")
            }}</span>
            <span v-else-if="date < today" class="badge badge-ghost badge-xs">{{
              t("week.past")
            }}</span>
            <span
              v-if="targetMoved && targetColumn === index"
              class="badge badge-soft badge-primary badge-xs ml-auto"
              >{{ t("week.dropDay") }}</span
            >
          </span>
          <span class="flex items-center gap-1.5 text-[12px] text-base-content/60">
            <span v-if="dayLoad(date)">{{ t("week.dayLoad", { hours: dayLoad(date) }) }}</span>
            <span v-if="overloadDates.includes(date)" class="text-warning">{{
              t("week.tooFull")
            }}</span>
          </span>
        </div>
      </div>

      <div class="relative isolate flex grow flex-col">
        <!-- The day columns run to the card's bottom, so the grid reads as a table. -->
        <div class="pointer-events-none absolute inset-0 -z-10 grid grid-cols-5" aria-hidden="true">
          <div
            v-for="(date, index) in dates"
            :key="date"
            class="border-l border-base-300/60 first:border-l-0"
            :class="{
              'bg-base-200/50': date < today,
              'bg-primary/[0.09]': date === today,
              'border-x border-dashed border-primary/40 bg-primary/[0.06]':
                targetMoved && targetColumn === index,
            }"
          ></div>
        </div>

        <div
          class="grid grow"
          :style="{
            gridAutoRows: 'minmax(56px, auto)',
            gridTemplateColumns: `repeat(${dates.length}, minmax(0, 1fr))`,
          }"
        >
          <div
            v-for="row in rowCount"
            :key="`line-${row}`"
            class="pointer-events-none border-base-300/60"
            :class="{ 'border-t': row > 1 }"
            :style="{ gridRow: row, gridColumn: '1 / -1' }"
            aria-hidden="true"
          ></div>
          <div
            v-for="lane in lanes"
            :key="lane.task.id"
            :data-lane="lane.task.id"
            class="group relative z-10 mx-[3px] my-1.5 flex min-w-0 flex-col justify-center gap-0.5 overflow-hidden rounded-lg border px-3 py-1 transition-[border-color,background-color,box-shadow] duration-150 hover:border-current/50 hover:shadow-sm"
            :class="[
              skin(lane),
              {
                'opacity-40': draggingId === lane.task.id,
                'shadow-[inset_0_2px_0_var(--color-primary)]':
                  targetMoved && dropBefore === lane.task.id && draggingId !== lane.task.id,
              },
            ]"
            :style="boxOf(lane)"
            role="button"
            tabindex="0"
            :aria-label="t('week.ganttBarAria', { title: lane.task.title })"
            @pointerdown="startDrag($event, lane)"
            @pointermove="drag.move($event)"
            @pointerup="drag.end()"
            @pointercancel="drag.cancel()"
            @click="openTask(lane)"
            @keydown.enter.prevent="openTask(lane)"
            @keydown.space.prevent="openTask(lane)"
            @keydown.up.prevent="moveBy(lane.task.id, -1)"
            @keydown.down.prevent="moveBy(lane.task.id, 1)"
          >
            <span
              v-for="tick in lane.to - lane.from"
              :key="tick"
              class="pointer-events-none absolute inset-y-0 border-l border-current opacity-20"
              :style="{ left: `${(tick * 100) / (lane.to - lane.from + 1)}%` }"
              aria-hidden="true"
            ></span>
            <div v-if="lane.task.parentTitle" class="flex min-w-0">
              <ParentBadge :title="lane.task.parentTitle" />
            </div>
            <div class="relative flex min-w-0 items-center gap-1.5">
              <button
                v-if="canComplete(lane)"
                class="flex shrink-0 rounded-full disabled:opacity-60"
                :aria-label="doneLabel(lane)"
                :title="doneLabel(lane)"
                :disabled="busy"
                @click.stop="complete(lane)"
              >
                <StatusDot :status="lane.task.status" :parked="lane.task.parked" />
              </button>
              <span v-else class="shrink-0">
                <StatusDot :status="lane.task.status" :parked="lane.task.parked" />
              </span>
              <span
                class="truncate text-[13.5px]"
                :class="{ 'text-base-content/60 line-through': isDone(lane) }"
              >
                {{ lane.task.title }}
              </span>
              <div
                v-if="!lane.row.history"
                class="absolute inset-y-0 -right-2 flex -translate-y-px items-center gap-1 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none"
              >
                <button
                  v-if="canStart(lane)"
                  class="grid size-5 place-items-center rounded-md hover:opacity-70 disabled:opacity-50"
                  :aria-label="t('task.startAria', { title: lane.task.title })"
                  :title="t('task.startAria', { title: lane.task.title })"
                  :disabled="busy"
                  @click.stop="start(lane)"
                >
                  <Play :size="16" aria-hidden="true" />
                </button>
                <button
                  v-if="canPark(lane)"
                  class="grid size-5 place-items-center rounded-md hover:opacity-70 disabled:opacity-50"
                  :aria-label="t('task.suspendAria', { title: lane.task.title })"
                  :title="t('task.suspendAria', { title: lane.task.title })"
                  :disabled="busy"
                  @click.stop="park(lane)"
                >
                  <Pause :size="16" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div v-if="hasBadges(lane)" class="flex min-w-0 items-center gap-1 text-[12px]">
              <span v-if="lane.row.conflict" class="badge badge-soft badge-error badge-xs shrink-0">
                {{ t("task.notFit") }}
              </span>
              <span v-if="lane.task.parked" class="badge badge-ghost badge-xs shrink-0">
                {{ parkedLabel(lane) }}
              </span>
              <span
                v-if="lane.task.projectName"
                class="badge badge-soft badge-primary badge-xs max-w-16 shrink-0"
                :title="lane.task.projectName"
              >
                <span class="min-w-0 truncate">{{ lane.task.projectName }}</span>
              </span>
              <PriorityBadge :priority="lane.task.priority" />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

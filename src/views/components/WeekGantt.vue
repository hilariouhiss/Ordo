<script setup lang="ts">
import { Hourglass, Pause, Play } from "@lucide/vue";
import { computed, nextTick, ref } from "vue";
import { shortDate, shortDateTime, todayIso, weekdayLabel } from "../../lib/dates";
import { askNotice, askSuspend, askWaiting } from "../../lib/dialog";
import { formatEffort } from "../../lib/effort";
import { errorText, t } from "../../lib/i18n";
import type { PlannedDay, WeekLane } from "../../lib/plan";
import { groupLanes } from "../../lib/plan";
import { usePointerDrag, type PointerDrag } from "../../lib/pointerDrag";
import { canSuspendTask, canWaitTask } from "../../lib/status";
import { waitDefaults, waitingOnName } from "../../lib/waiting";
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
    // A day the task already covers keeps its start; only the manual order changes.
    if (lane && props.dates.slice(lane.from, lane.to + 1).includes(day))
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
function columnOf(lane: WeekLane): Record<string, string> {
  return { gridColumn: `${lane.from + 1} / span ${lane.to - lane.from + 1}` };
}
const isDone = (lane: WeekLane): boolean => lane.task.status === "done";

/** Bar skin: finished work recedes, conflict alarms, shared work is dashed. */
function skin(lane: WeekLane): string {
  if (isDone(lane)) {
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

/** Every fact the list packs into a card, folded into the bar's second line. */
function metaOf(lane: WeekLane): string {
  const parts = [formatEffort(lane.task.effortMinutes)];
  if (lane.row.clamped) parts.push(t("task.laterStart", { date: shortDate(lane.row.start) }));
  else if (lane.row.spans) {
    parts.push(t("task.spanEnd", { days: lane.row.days, date: shortDate(lane.row.end) }));
  }
  if (lane.task.actualFinishAt) {
    parts.push(t("task.doneAt", { date: shortDateTime(lane.task.actualFinishAt) }));
  } else if (lane.task.waiting) {
    parts.push(
      lane.task.followUpDate
        ? t("task.followUpOn", { date: shortDate(lane.task.followUpDate) })
        : t("task.noFollowUp"),
    );
  } else if (lane.row.conflict && lane.task.expectedFinishDate) {
    parts.push(t("task.expectedFinish") + " " + shortDate(lane.task.expectedFinishDate));
  }
  return parts.join(" · ");
}

const canComplete = (lane: WeekLane): boolean => !lane.row.history && !lane.task.children.length;
const canStart = (lane: WeekLane): boolean =>
  !lane.task.children.length &&
  !isDone(lane) &&
  (lane.task.status === "todo" || lane.task.suspended);
const canSuspend = (lane: WeekLane): boolean => canSuspendTask(lane.task);
const canWait = (lane: WeekLane): boolean => canWaitTask(lane.task);
const waitingName = (lane: WeekLane): string | null => waitingOnName(lane.task, appVM.state.people);
const doneLabel = (lane: WeekLane): string =>
  t(isDone(lane) ? "task.reopenAria" : "task.doneAria", { title: lane.task.title });
const waitLabel = (lane: WeekLane): string =>
  t(lane.task.waiting ? "task.followUpAria" : "task.waitAria", { title: lane.task.title });

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

async function wait(lane: WeekLane): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const draft = await askWaiting(
      t("task.waitDialogTitle", { title: lane.task.title }),
      waitDefaults(lane.task, appVM.state.people, todayIso()),
    );
    if (!draft) return;
    await taskRowVM.wait(lane.task, draft.personId, draft.followUpDate || null);
    emit("changed");
  } catch (e) {
    void askNotice(t("common.actionFailed"), errorText(e));
  } finally {
    busy.value = false;
  }
}

async function suspend(lane: WeekLane): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const draft = await askSuspend(t("task.suspendAria", { title: lane.task.title }));
    if (!draft) return;
    await taskRowVM.suspend(lane.task, draft.until || null, draft.reason || null);
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
  if (event.button !== 0 || lane.row.history) return;
  if ((event.target as HTMLElement).closest("button")) return;
  drag.start(event, lane.task.id);
}

async function moveBy(id: string, delta: -1 | 1): Promise<void> {
  if (lanes.value.find((lane) => lane.task.id === id)?.row.history) return;
  await weekVM.moveBy(id, delta);
  await nextTick();
  gridEl.value?.querySelector<HTMLElement>(`[data-lane="${id}"] [role="button"]`)?.focus();
}
</script>

<template>
  <div class="flex grow flex-col gap-1.5">
    <div class="flex h-[26px] items-center gap-2 px-0.5 text-[10px] text-base-content/40">
      <span class="font-medium text-base-content/55">{{ t("week.ganttCaption") }}</span>
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
          :class="{ 'bg-base-200/60': date < today, 'bg-primary/[0.07]': date === today }"
        >
          <span class="flex min-w-0 items-center gap-1.5">
            <span class="text-[11.5px] font-medium text-base-content/55">{{
              weekdayLabel(date)
            }}</span>
            <span class="text-[11px] text-base-content/40">{{ shortDate(date) }}</span>
            <span v-if="date === today" class="badge badge-soft badge-primary badge-xs">{{
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
          <span class="flex items-center gap-1.5 text-[10px] text-base-content/40">
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
              'bg-primary/[0.05]': date === today,
              'border-x border-dashed border-primary/40 bg-primary/[0.06]':
                targetMoved && targetColumn === index,
            }"
          ></div>
        </div>

        <div
          v-for="lane in lanes"
          :key="lane.task.id"
          :data-lane="lane.task.id"
          class="group flex h-14 shrink-0 border-t border-base-300/60 first:border-t-0"
          :class="{
            'shadow-[inset_0_2px_0_var(--color-primary)]':
              targetMoved && dropBefore === lane.task.id && draggingId !== lane.task.id,
          }"
        >
          <div class="relative grid flex-1 grid-cols-5">
            <div v-for="date in dates" :key="date" class="row-start-1"></div>
            <div
              class="relative z-10 row-start-1 mx-[3px] my-auto flex h-12 flex-col justify-center gap-0.5 overflow-hidden rounded-xl border px-3 transition-[border-color,background-color,box-shadow] duration-150 hover:border-current/50 hover:shadow-sm"
              :class="[skin(lane), { 'opacity-40': draggingId === lane.task.id }]"
              :style="columnOf(lane)"
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
              <div class="relative flex min-w-0 items-center gap-1.5">
                <button
                  v-if="canComplete(lane)"
                  class="flex shrink-0 rounded-full disabled:opacity-60"
                  :aria-label="doneLabel(lane)"
                  :title="doneLabel(lane)"
                  :disabled="busy"
                  @click.stop="complete(lane)"
                >
                  <StatusDot
                    :status="lane.task.status"
                    :suspended="lane.task.suspended"
                    :waiting="lane.task.waiting"
                  />
                </button>
                <span v-else class="shrink-0">
                  <StatusDot
                    :status="lane.task.status"
                    :suspended="lane.task.suspended"
                    :waiting="lane.task.waiting"
                  />
                </span>
                <span
                  class="truncate text-[13.5px]"
                  :class="{ 'text-base-content/40 line-through': isDone(lane) }"
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
                    v-if="canSuspend(lane)"
                    class="grid size-5 place-items-center rounded-md hover:opacity-70 disabled:opacity-50"
                    :aria-label="t('task.suspendAria', { title: lane.task.title })"
                    :title="t('task.suspendAria', { title: lane.task.title })"
                    :disabled="busy"
                    @click.stop="suspend(lane)"
                  >
                    <Pause :size="16" aria-hidden="true" />
                  </button>
                  <button
                    v-if="canWait(lane)"
                    class="grid size-5 place-items-center rounded-md hover:opacity-70 disabled:opacity-50"
                    :aria-label="waitLabel(lane)"
                    :title="waitLabel(lane)"
                    :disabled="busy"
                    @click.stop="wait(lane)"
                  >
                    <Hourglass :size="16" aria-hidden="true" />
                  </button>
                </div>
              </div>
              <div class="flex min-w-0 items-center gap-1 text-[10.5px]">
                <span
                  v-if="lane.row.conflict"
                  class="badge badge-soft badge-error badge-xs shrink-0"
                >
                  {{ t("task.notFit") }}
                </span>
                <ParentBadge
                  v-if="lane.task.parentTitle"
                  :title="lane.task.parentTitle"
                  class="max-w-20"
                />
                <span
                  v-if="lane.task.projectName"
                  class="badge badge-soft badge-primary badge-xs max-w-16 shrink-0"
                  :title="lane.task.projectName"
                >
                  <span class="min-w-0 truncate">{{ lane.task.projectName }}</span>
                </span>
                <PriorityBadge :priority="lane.task.priority" />
                <span
                  v-if="lane.task.waiting"
                  class="badge badge-soft badge-info badge-xs shrink-0"
                >
                  {{
                    waitingName(lane)
                      ? t("task.waitingOn", { name: waitingName(lane) })
                      : t("task.waitingNoName")
                  }}
                </span>
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
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

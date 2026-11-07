<script setup lang="ts">
import { computed, nextTick, ref } from "vue";
import { AnimatePresence, motion } from "motion-v";
import { shortDate } from "../../lib/dates";
import { t } from "../../lib/i18n";
import { easeOut, listItemMotion } from "../../lib/motion";
import { weekPanels, type PlannedDay, type PlannedRow, type WeekPanel } from "../../lib/plan";
import { usePointerDrag, type PointerDrag } from "../../lib/pointerDrag";
import { anchorFor, boardDropAt, coveredDays, type BoardDrop } from "../../lib/weekDrop";
import { taskSheetVM } from "../../viewmodels/taskSheetVM";
import { weekVM } from "../../viewmodels/weekVM";
import WeekTaskCard from "./WeekTaskCard.vue";

const props = defineProps<{
  days: PlannedDay[];
  dates: string[];
  today: string;
  /** A card dragged in from the week's bottom stack. */
  outsideMoved?: boolean;
  outsideTarget?: BoardDrop | null;
}>();
const emit = defineEmits<{ changed: [] }>();

const boardEl = ref<HTMLElement | null>(null);
const panels = computed(() => weekPanels(props.days, props.dates, props.today));
const rowsByDate = computed(() => {
  const map = new Map<string, PlannedRow[]>();
  for (const day of panels.value) {
    map.set(
      day.date,
      [...day.rows].sort(
        (a, b) => a.task.sortOrder - b.task.sortOrder || a.task.id.localeCompare(b.task.id),
      ),
    );
  }
  return map;
});
/** The days each open task already shows on, so a drop inside them only reorders. */
const coverage = computed(() => coveredDays(panels.value));

const dragged = ref(false);
// The type is spelled out: a drag reports the deck it is over, and the deck is read
// from the drag, so inference alone runs in a circle.
const drag: PointerDrag<BoardDrop> = usePointerDrag<BoardDrop>({
  targetOf: ({ x, y }) => boardDropAt(boardEl.value, x, y, activeDeck.value),
  scroller: () => boardEl.value?.closest("main") ?? null,
  drop: (id, target) => {
    // Dropping back before the card itself changes nothing.
    if (target.beforeId === id) return;
    const beforeId = anchorFor(panels.value, target.day, target.beforeId);
    // A day the task already covers keeps its start; only the manual order changes.
    if (coverage.value.get(id)?.has(target.day)) void weekVM.move(id, beforeId);
    else void weekVM.place(id, target.day, beforeId);
  },
  onRelease: (moved) => {
    // A drag ends with a click, even one released outside every panel.
    if (!moved) return;
    dragged.value = true;
    window.setTimeout(() => (dragged.value = false), 0);
  },
});
const draggingId = computed(() => drag.id.value);

/** The rail opened by hover or focus; a drag keeps its own card open. */
const hoveredDate = ref<string | null>(null);
const focusedDate = ref<string | null>(null);
let dragFront: string | null = null;
const activeDeck = computed<string | null>(() =>
  drag.id.value ? dragFront : (hoveredDate.value ?? focusedDate.value),
);
const openIndex = computed(() => {
  const date = activeDeck.value;
  return date ? panels.value.findIndex((day) => day.date === date) : -1;
});

const target = computed<BoardDrop | null>(() => drag.target.value ?? props.outsideTarget ?? null);
const targetMoved = computed(() => drag.moved.value || props.outsideMoved === true);

const loads = weekVM.loads;
const overloads = weekVM.overloadDates;
function dayLoad(date: string): number {
  return loads.value.get(date) ?? 0;
}
function rowsOf(day: PlannedDay): PlannedRow[] {
  return rowsByDate.value.get(day.date) ?? [];
}
function insertBefore(day: string, beforeId: string): boolean {
  return (
    targetMoved.value &&
    target.value?.day === day &&
    target.value?.beforeId === beforeId &&
    beforeId !== draggingId.value
  );
}
function insertAfter(day: string): boolean {
  return targetMoved.value && target.value?.day === day && target.value?.beforeId === null;
}

function enterDeck(day: WeekPanel): void {
  if (!day.stacked || drag.id.value || props.outsideMoved) return;
  hoveredDate.value = day.date;
}
function focusDeck(day: WeekPanel): void {
  if (!day.stacked || drag.id.value || props.outsideMoved) return;
  focusedDate.value = day.date;
}
/**
 * A rail overlaps the one before it, so only its 44px rail shows; opening one makes the
 * panel after it step aside. A column after a closed rail covers it the same way, which
 * is how today reads on top of the last rail. Two columns keep a gap.
 */
function panelMargin(index: number): string {
  const previous = panels.value[index - 1];
  if (!previous) return "";
  if (!previous.stacked) return "ml-2.5";
  return index - 1 === openIndex.value ? "ml-2" : "-ml-[124px]";
}
function panelBorder(day: WeekPanel): string {
  if (targetMoved.value && target.value?.day === day.date) return "border-primary";
  if (activeDeck.value === day.date) return "border-primary/60";
  return day.isToday ? "border-primary/40" : "border-base-300";
}
function panelZ(index: number, day: WeekPanel): number {
  return activeDeck.value === day.date ? 40 : index + 1;
}

function startDrag(event: PointerEvent, taskId: string): void {
  dragFront = activeDeck.value;
  drag.start(event, taskId);
}

function openTask(taskId: string): void {
  if (dragged.value) {
    dragged.value = false;
    return;
  }
  // Selecting a title to copy it also ends with a click; that must not open the sheet.
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  void taskSheetVM.open(taskId);
}

async function moveBy(taskId: string, delta: -1 | 1): Promise<void> {
  await weekVM.moveBy(taskId, delta);
  await nextTick();
  boardEl.value?.querySelector<HTMLElement>('[data-task-id="' + taskId + '"]')?.focus();
}
</script>

<template>
  <div class="flex grow flex-col gap-1.5">
    <div class="flex h-[26px] items-center gap-2 px-0.5 text-[10px] text-base-content/40">
      <span class="font-medium text-base-content/55">{{ t("week.ganttCaption") }}</span>
      <span class="truncate">{{ t("week.ganttHint") }}</span>
    </div>

    <div
      ref="boardEl"
      data-gantt-board
      :data-deck-open="activeDeck ?? undefined"
      class="flex min-h-[140px] grow items-stretch"
      :class="{ 'select-none': draggingId }"
    >
      <div
        v-for="(day, index) in panels"
        :key="day.date"
        :data-day="day.date"
        class="relative rounded-xl border bg-base-100 transition-[margin,border-color] duration-200 ease-out motion-reduce:transition-none"
        :class="[
          panelMargin(index),
          panelBorder(day),
          day.stacked ? 'shrink-0 overflow-hidden' : 'flex min-w-0 flex-1 flex-col',
        ]"
        :style="{ width: day.stacked ? '168px' : undefined, zIndex: panelZ(index, day) }"
        @mouseenter="enterDeck(day)"
        @mouseleave="hoveredDate = null"
        @focusin="focusDeck(day)"
        @focusout="focusedDate = null"
      >
        <template v-if="day.stacked">
          <button
            type="button"
            class="absolute inset-y-0 left-0 z-10 flex w-11 flex-col items-start gap-0.5 px-2 pt-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            :aria-label="
              t('week.deckDayAria', {
                weekday: day.weekday,
                date: shortDate(day.date),
                count: rowsOf(day).length,
              })
            "
          >
            <span class="text-[10px] font-semibold text-base-content/65">{{ day.weekday }}</span>
            <span class="text-[9px] tabular-nums text-base-content/45">{{
              shortDate(day.date)
            }}</span>
            <span class="text-[8.5px] text-base-content/35">{{
              t("week.dayCount", { count: rowsOf(day).length })
            }}</span>
          </button>
          <motion.div
            v-if="activeDeck === day.date"
            :initial="{ opacity: 0, y: 3 }"
            :animate="{ opacity: 1, y: 0 }"
            :transition="{ duration: 0.12, ease: easeOut }"
            class="pr-1.5 pt-1.5 pb-1.5 pl-11"
          >
            <ul class="flex flex-col gap-1">
              <template v-for="row in rowsOf(day)" :key="row.task.id">
                <li
                  v-if="insertBefore(day.date, row.task.id)"
                  class="h-0.5 rounded-full bg-primary"
                ></li>
                <li>
                  <WeekTaskCard
                    :data-task-id="row.history ? undefined : row.task.id"
                    :task="row.task"
                    :row="row"
                    :readonly="row.history === true"
                    :dragging="draggingId === row.task.id"
                    compact
                    @open="openTask(row.task.id)"
                    @changed="emit('changed')"
                    @reorder="moveBy(row.task.id, $event)"
                    @dragstart="startDrag($event, row.task.id)"
                    @dragmove="drag.move($event)"
                    @dragend="drag.end()"
                    @dragcancel="drag.cancel()"
                  />
                </li>
              </template>
              <li v-if="insertAfter(day.date)" class="h-0.5 rounded-full bg-primary"></li>
            </ul>
          </motion.div>
        </template>
        <template v-else>
          <div
            class="flex items-center gap-1.5 px-2.5 pt-2 pb-1 text-[10.5px] text-base-content/40"
          >
            <span class="font-medium text-base-content/55">{{ day.weekday }}</span>
            <span class="tabular-nums">{{ shortDate(day.date) }}</span>
            <span v-if="day.isToday" class="badge badge-soft badge-primary badge-xs">{{
              t("week.today")
            }}</span>
            <span v-else-if="day.isPast" class="badge badge-ghost badge-xs">{{
              t("week.past")
            }}</span>
            <span v-if="dayLoad(day.date)" class="ml-auto tabular-nums">{{
              t("week.dayLoad", { hours: dayLoad(day.date) })
            }}</span>
            <span
              v-if="targetMoved && target?.day === day.date"
              class="badge badge-soft badge-primary badge-xs"
              >{{ t("week.dropDay") }}</span
            >
            <span v-if="overloads.includes(day.date)" class="text-warning">{{
              t("week.tooFull")
            }}</span>
          </div>
          <AnimatePresence
            as="ul"
            mode="popLayout"
            :initial="false"
            class="flex min-h-0 flex-1 flex-col gap-1 px-1.5 pb-1.5"
          >
            <motion.li
              v-for="row in rowsOf(day)"
              :key="row.task.id"
              v-bind="listItemMotion"
              class="relative"
            >
              <span
                v-if="insertBefore(day.date, row.task.id)"
                class="pointer-events-none absolute -top-1 right-0 left-0 h-0.5 rounded-full bg-primary"
              ></span>
              <WeekTaskCard
                :data-task-id="row.history ? undefined : row.task.id"
                :task="row.task"
                :row="row"
                :readonly="row.history === true"
                :dragging="draggingId === row.task.id"
                @open="openTask(row.task.id)"
                @changed="emit('changed')"
                @reorder="moveBy(row.task.id, $event)"
                @dragstart="startDrag($event, row.task.id)"
                @dragmove="drag.move($event)"
                @dragend="drag.end()"
                @dragcancel="drag.cancel()"
              />
            </motion.li>
            <li
              v-if="insertAfter(day.date)"
              :key="'after-' + day.date"
              class="h-0.5 rounded-full bg-primary"
            ></li>
          </AnimatePresence>
        </template>
      </div>
    </div>
  </div>
</template>

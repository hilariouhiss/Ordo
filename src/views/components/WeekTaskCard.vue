<script setup lang="ts">
import { Pause, Play } from "@lucide/vue";
import { computed, ref } from "vue";
import { shortDate, shortDateTime } from "../../lib/dates";
import { askNotice, askSuspend } from "../../lib/dialog";
import { formatEffort } from "../../lib/effort";
import { errorText, t } from "../../lib/i18n";
import type { PlannedRow } from "../../lib/plan";
import { canSuspendTask } from "../../lib/status";
import type { Task } from "../../model/types";
import { taskRowVM } from "../../viewmodels/taskRowVM";
import PriorityBadge from "./PriorityBadge.vue";
import StatusDot from "./StatusDot.vue";

/**
 * One task on the week board: a two-line card shared by the day columns and the raised
 * past-day card. It owns its own start / park / complete actions; dragging and ordering
 * stay with the board so both can share one drag.
 */
const props = defineProps<{
  task: Task;
  row: PlannedRow;
  readonly?: boolean;
  dragging?: boolean;
  /** The narrow past-day deck: hover actions would cover the title. */
  compact?: boolean;
}>();
const emit = defineEmits<{
  open: [];
  changed: [];
  reorder: [delta: -1 | 1];
  dragstart: [event: PointerEvent];
  dragmove: [event: PointerEvent];
  dragend: [];
  dragcancel: [];
}>();

const busy = ref(false);
const isDone = computed(() => props.task.status === "done");
const canComplete = computed(() => !props.readonly && !props.task.children.length);
const canStart = computed(
  () =>
    !props.task.children.length &&
    !isDone.value &&
    (props.task.status === "todo" || props.task.suspended),
);
const canSuspend = computed(() => !props.readonly && canSuspendTask(props.task));
const doneLabel = computed(() =>
  t(isDone.value ? "task.reopenAria" : "task.doneAria", { title: props.task.title }),
);

const skin = computed(() => {
  if (isDone.value) {
    return "border-base-300 border-l-[3px] border-l-base-content/20 bg-base-300/50 text-base-content/40";
  }
  if (props.row.conflict) {
    return "border-error/40 border-l-[3px] border-l-error bg-error/[0.10] text-error";
  }
  if (!props.task.exclusive) {
    return "border-dashed border-secondary/50 border-l-[3px] border-l-secondary/60 bg-secondary/10 text-secondary";
  }
  return "border-primary/30 border-l-[3px] border-l-primary bg-primary/[0.12] text-primary";
});

/** Every fact the list packs into a card, folded into the second line. */
const meta = computed(() => {
  const parts = [formatEffort(props.task.effortMinutes)];
  if (props.row.clamped) parts.push(t("task.laterStart", { date: shortDate(props.row.start) }));
  else if (props.row.spans) {
    parts.push(t("task.spanEnd", { days: props.row.days, date: shortDate(props.row.end) }));
  }
  if (props.task.actualFinishAt) {
    parts.push(t("task.doneAt", { date: shortDateTime(props.task.actualFinishAt) }));
  } else if (props.row.conflict && props.task.expectedFinishDate) {
    parts.push(t("task.expectedFinish") + " " + shortDate(props.task.expectedFinishDate));
  }
  return parts.join(" · ");
});

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

function complete(): void {
  if (!canComplete.value) return;
  void run(() => taskRowVM.toggleDone(props.task));
}

function start(): void {
  void run(() => taskRowVM.start(props.task));
}

async function suspend(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const draft = await askSuspend(t("task.suspendAria", { title: props.task.title }));
    if (!draft) return;
    await taskRowVM.suspend(props.task, draft.until || null, draft.reason || null);
    emit("changed");
  } catch (e) {
    void askNotice(t("common.actionFailed"), errorText(e));
  } finally {
    busy.value = false;
  }
}

function onPointerDown(event: PointerEvent): void {
  if (props.readonly || event.button !== 0) return;
  if ((event.target as HTMLElement).closest("button")) return;
  emit("dragstart", event);
}

function reorder(delta: -1 | 1): void {
  if (props.readonly) return;
  emit("reorder", delta);
}
</script>

<template>
  <div
    role="button"
    tabindex="0"
    class="group relative flex cursor-grab touch-none flex-col justify-center gap-0.5 overflow-hidden rounded-[10px] border px-2.5 py-1.5 transition-[translate,border-color,background-color,box-shadow,opacity] duration-150 ease-out hover:-translate-y-px hover:border-current/50 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none motion-reduce:transition-none"
    :class="[skin, { 'cursor-default opacity-40': dragging }]"
    @pointerdown="onPointerDown"
    @pointermove="emit('dragmove', $event)"
    @pointerup="emit('dragend')"
    @pointercancel="emit('dragcancel')"
    @click="emit('open')"
    @keydown.enter.prevent="emit('open')"
    @keydown.space.prevent="emit('open')"
    @keydown.up.prevent="reorder(-1)"
    @keydown.down.prevent="reorder(1)"
  >
    <div class="flex min-w-0 items-center gap-1.5">
      <button
        v-if="canComplete"
        class="flex shrink-0 rounded-full disabled:opacity-60"
        :aria-label="doneLabel"
        :title="doneLabel"
        :disabled="busy"
        @click.stop="complete"
      >
        <StatusDot :status="task.status" :suspended="task.suspended" />
      </button>
      <span v-else class="shrink-0">
        <StatusDot :status="task.status" :suspended="task.suspended" />
      </span>
      <span class="truncate text-[12.5px]" :class="{ 'text-base-content/40 line-through': isDone }">
        {{ task.title }}
      </span>
    </div>
    <div class="flex min-w-0 items-center gap-1 text-[10px]">
      <span v-if="row.conflict" class="badge badge-soft badge-error badge-xs shrink-0">
        {{ t("task.notFit") }}
      </span>
      <span
        v-if="task.parentTitle"
        class="badge badge-soft badge-primary badge-xs max-w-20 shrink-0"
        :title="t('task.parentTask', { title: task.parentTitle })"
      >
        <span class="min-w-0 truncate">{{ task.parentTitle }}</span>
      </span>
      <span
        v-if="task.projectName"
        class="badge badge-soft badge-primary badge-xs max-w-16 shrink-0"
        :title="task.projectName"
      >
        <span class="min-w-0 truncate">{{ task.projectName }}</span>
      </span>
      <PriorityBadge :priority="task.priority" />
      <span
        v-if="!task.exclusive"
        class="badge badge-ghost badge-xs shrink-0"
        :title="t('task.sharedHint')"
      >
        {{ t("task.shared") }}
      </span>
      <span class="min-w-0 truncate" :title="meta">{{ meta }}</span>
    </div>
    <div
      v-if="!compact && !readonly"
      class="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center gap-0.5 rounded-md bg-base-100/90 px-0.5 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-within:opacity-100 motion-reduce:transition-none"
    >
      <button
        v-if="canStart"
        class="grid size-5 place-items-center rounded-md hover:bg-base-100 disabled:opacity-50"
        :aria-label="t('task.startAria', { title: task.title })"
        :title="t('task.startAria', { title: task.title })"
        :disabled="busy"
        @click.stop="start"
      >
        <Play :size="12" aria-hidden="true" />
      </button>
      <button
        v-if="canSuspend"
        class="grid size-5 place-items-center rounded-md hover:bg-base-100 disabled:opacity-50"
        :aria-label="t('task.suspendAria', { title: task.title })"
        :title="t('task.suspendAria', { title: task.title })"
        :disabled="busy"
        @click.stop="suspend"
      >
        <Pause :size="12" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>

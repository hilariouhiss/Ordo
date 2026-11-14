<script setup lang="ts">
import { Check, ChevronRight, Hourglass, Pause, Play } from "@lucide/vue";
import { motion } from "motion-v";
import { computed, ref } from "vue";
import { shortDate, localTime, todayIso } from "../../lib/dates";
import { askNotice, askSuspend, askWaiting } from "../../lib/dialog";
import { formatEffort } from "../../lib/effort";
import { errorText, t } from "../../lib/i18n";
import { easeOut, springSnappy } from "../../lib/motion";
import { canSuspendTask, canWaitTask } from "../../lib/status";
import { waitDefaults, waitingOnName } from "../../lib/waiting";
import { currentSubtask, subtaskLabel, subtasksDone } from "../../lib/subtasks";
import { daysSince, overdueDays } from "../../model/mappers";
import type { Task } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { taskRowVM } from "../../viewmodels/taskRowVM";
import ParentBadge from "./ParentBadge.vue";
import StatusDot from "./StatusDot.vue";

const props = withDefaults(
  defineProps<{
    task: Task;
    plan?: {
      start?: string;
      end: string;
      spans: boolean;
      days: number;
      /** The plan starts after this week, so the card sits on the week's last day. */
      clamped?: boolean;
      conflict: boolean;
    };
    dropLine?: boolean;
    showProject?: boolean;
    draggable?: boolean;
    /** A finished row in the past days: shown for the record, toggle off. */
    readonly?: boolean;
    /** Being dragged: dimmed through motion, never through an inline style. */
    dimmed?: boolean;
  }>(),
  { showProject: true, draggable: false, readonly: false, dimmed: false },
);
const emit = defineEmits<{
  open: [Task];
  changed: [];
  dragStart: [DragEvent, Task];
  dragEnd: [];
}>();

const ownerName = computed(
  () => appVM.state.people.find((p) => p.id === props.task.ownerId)?.name ?? null,
);
const meId = computed(() => appVM.me.value?.id ?? null);
/** "我" on every row is noise in a one-person ledger; only someone else is worth a column. */
const showOwner = computed(() => !!ownerName.value && props.task.ownerId !== meId.value);
const done = computed(() => subtasksDone(props.task.children));
const current = computed(() => currentSubtask(props.task.children));
const stepLine = computed(() => subtaskLabel(props.task.children));
const subtasksId = computed(() => `subtasks-${props.task.id}`);
const late = computed(() => overdueDays(props.task.expectedFinishDate, todayIso()));
const overdue = computed(
  () =>
    late.value > 0 && props.task.status !== "done" && !props.task.suspended && !props.task.waiting,
);
const conflictTitle = computed(() =>
  t("task.conflictTitle", {
    date: shortDate(props.plan?.end ?? null),
    due: shortDate(props.task.expectedFinishDate),
  }),
);

/**
 * The dim rides the row's own opacity animation. An inline `style.opacity` would do
 * the same job, but motion scrapes it as a forced value whenever `layout` is on and
 * then drops the animated opacity on the next render, freezing the row half-faded.
 */
const rowMotion = computed(() => ({
  layout: true,
  initial: false,
  animate: { opacity: props.dimmed ? 0.4 : 1 },
  exit: { opacity: 0, transition: { duration: 0.12, ease: easeOut } },
  transition: springSnappy,
}));

const busy = ref(false);
const expanded = ref(false);
const hasSubtasks = computed(() => props.task.children.length > 0);
const isDone = computed(() => props.task.status === "done");
const canStart = computed(
  () =>
    !hasSubtasks.value && !isDone.value && (props.task.status === "todo" || props.task.suspended),
);
const canSuspend = computed(() => canSuspendTask(props.task));
const doneLabel = computed(() =>
  t(isDone.value ? "task.reopenAria" : "task.doneAria", { title: props.task.title }),
);
const startLabel = computed(() => t("task.startAria", { title: props.task.title }));
const suspendLabel = computed(() => t("task.suspendAria", { title: props.task.title }));
const subtasksLabel = computed(() =>
  t(expanded.value ? "task.collapseSubtasks" : "task.expandSubtasks"),
);
const canWait = computed(() => canWaitTask(props.task));
const waitLabel = computed(() =>
  t(props.task.waiting ? "task.followUpAria" : "task.waitAria", { title: props.task.title }),
);
const waitingName = computed(() => waitingOnName(props.task, appVM.state.people));
const high = computed(() => props.task.priority === "high");
const doneAt = computed(() => localTime(props.task.actualFinishAt));

/** One quiet second line: who it waits on, the way it is parked, or the next subtask. */
const subline = computed(() => {
  if (props.task.waiting) {
    const who = waitingName.value
      ? t("task.waitingOn", { name: waitingName.value })
      : t("task.waitingNoName");
    const follow = props.task.followUpDate
      ? t("task.followUpOn", { date: shortDate(props.task.followUpDate) })
      : t("task.noFollowUp");
    return `${who} · ${follow}`;
  }
  if (props.task.suspended) {
    if (props.task.suspendedUntil) {
      return t("task.suspended", { date: shortDate(props.task.suspendedUntil) });
    }
    return props.task.suspendedAt
      ? t("task.suspendedFor", { days: daysSince(props.task.suspendedAt, todayIso()) })
      : t("task.suspendedNoDate");
  }
  return stepLine.value;
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

function toggleDone(): void {
  if (hasSubtasks.value) return;
  void run(() => taskRowVM.toggleDone(props.task));
}

function toggleSubtask(childId: string): void {
  // A finished row in the week is for the record: ticking a subtask would reopen it.
  if (props.readonly) return;
  const child = props.task.children.find((one) => one.id === childId);
  if (child) void run(() => taskRowVM.toggleSubtask(child));
}

function toggleExpanded(): void {
  expanded.value = !expanded.value;
}

function onRowKey(event: KeyboardEvent): void {
  if (event.target !== event.currentTarget) return;
  emit("open", props.task);
}

// Selecting the title to copy it also ends with a click; that must not open the sheet.
function onRowClick(): void {
  const selection = window.getSelection();
  if (selection && !selection.isCollapsed) return;
  emit("open", props.task);
}

function start(): void {
  void run(() => taskRowVM.start(props.task));
}

/** Parks the task on someone else's reply, or moves the day to chase them. */
async function wait(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const draft = await askWaiting(
      t("task.waitDialogTitle", { title: props.task.title }),
      waitDefaults(props.task, appVM.state.people, todayIso()),
    );
    if (!draft) return;
    await taskRowVM.wait(props.task, draft.personId, draft.followUpDate || null);
    emit("changed");
  } catch (e) {
    void askNotice(t("common.actionFailed"), errorText(e));
  } finally {
    busy.value = false;
  }
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
</script>

<template>
  <motion.li
    v-bind="rowMotion"
    class="group relative grid min-h-11 cursor-pointer grid-cols-[14px_16px_minmax(0,1fr)_104px_66px_48px_58px] items-center gap-2 px-3 py-2 hover:bg-base-200/60 focus-visible:ring-2 focus-visible:ring-primary/40"
    :draggable="draggable"
    tabindex="0"
    @click="onRowClick"
    @keydown.enter="onRowKey"
    @dragstart="emit('dragStart', $event, task)"
    @dragend="emit('dragEnd')"
  >
    <span
      v-if="dropLine"
      class="pointer-events-none absolute -top-px right-3 left-3 h-0.5 rounded-full bg-primary"
    ></span>
    <span class="grid size-3.5 place-items-center"><slot name="leading" /></span>
    <button
      v-if="!hasSubtasks && !readonly"
      type="button"
      class="grid size-4 place-items-center rounded-full disabled:opacity-60"
      :aria-label="doneLabel"
      :title="doneLabel"
      :disabled="busy"
      @click.stop="toggleDone"
    >
      <StatusDot :status="task.status" :suspended="task.suspended" :waiting="task.waiting" />
    </button>
    <span
      v-else
      class="grid size-4 place-items-center"
      :title="hasSubtasks ? t('task.subtasksHint') : undefined"
      @click.stop
    >
      <StatusDot :status="task.status" :suspended="task.suspended" :waiting="task.waiting" />
    </span>

    <div class="flex min-w-0 flex-col justify-center gap-0.5">
      <div class="flex min-w-0 items-center gap-2">
        <span
          class="size-1 shrink-0 rounded-full"
          :class="high ? 'bg-error' : 'bg-transparent'"
          :title="high ? t('task.priorityHigh') : undefined"
          aria-hidden="true"
        ></span>
        <ParentBadge v-if="task.parentTitle" :title="task.parentTitle" class="max-w-28" />
        <span
          class="min-w-0 truncate text-[14px]"
          :class="{ 'text-base-content/55 line-through': isDone }"
        >
          {{ task.title }}
        </span>
        <span class="shrink-0 text-[12px] tabular-nums text-base-content/60">
          {{ formatEffort(task.effortMinutes) }}
        </span>
        <button
          v-if="hasSubtasks"
          type="button"
          class="flex shrink-0 items-center gap-0.5 rounded px-1 py-0.5 text-[11px] tabular-nums text-base-content/60 hover:bg-base-300/60 hover:text-base-content"
          :aria-expanded="expanded"
          :aria-controls="expanded ? subtasksId : undefined"
          :title="subtasksLabel"
          :aria-label="subtasksLabel"
          @click.stop="toggleExpanded"
        >
          {{ done }}/{{ task.children.length }}
          <ChevronRight
            :size="11"
            aria-hidden="true"
            class="transition-transform duration-200"
            :class="{ 'rotate-90': expanded }"
          />
        </button>
        <span
          v-if="task.carryCount"
          class="shrink-0 text-[11.5px] text-warning"
          :title="t('task.carry', { count: task.carryCount })"
        >
          {{ t("task.carry", { count: task.carryCount }) }}
        </span>
        <span
          v-if="plan?.conflict"
          class="shrink-0 text-[11.5px] font-medium text-warning"
          :title="conflictTitle"
        >
          {{ t("task.notFit") }}
        </span>
      </div>
      <p
        v-if="subline"
        class="truncate text-[11.5px] leading-4"
        :class="task.waiting || task.suspended ? 'text-warning' : 'text-base-content/60'"
      >
        {{ subline }}
      </p>
    </div>

    <span class="min-w-0 justify-self-end">
      <span
        v-if="showProject && task.projectName"
        class="inline-block max-w-full truncate rounded border border-base-300 px-1.5 py-px align-middle text-[11.5px] text-base-content/70"
        :title="task.projectName"
      >
        {{ task.projectName }}
      </span>
    </span>

    <span class="flex min-w-0 flex-col items-end text-[12px] leading-tight tabular-nums">
      <template v-if="isDone">
        <span class="flex items-center gap-1 text-base-content/55">
          <Check :size="11" aria-hidden="true" />
          {{ doneAt }}
        </span>
      </template>
      <template v-else-if="overdue">
        <span class="font-medium text-error">{{ t("task.overdue", { days: late }) }}</span>
      </template>
      <template v-else-if="task.expectedFinishDate">
        <span class="text-base-content/70">{{ shortDate(task.expectedFinishDate) }}</span>
        <span v-if="task.expectedFinishTime" class="text-[11.5px] text-base-content/55">
          {{ task.expectedFinishTime }}
        </span>
      </template>
    </span>

    <span class="truncate text-[12px] text-base-content/70">{{ showOwner ? ownerName : "" }}</span>

    <span
      class="flex justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
    >
      <slot name="actions" />
      <button
        v-if="canStart"
        type="button"
        class="grid size-6 place-items-center rounded text-base-content/55 hover:bg-base-300/70 hover:text-primary disabled:opacity-50"
        :aria-label="startLabel"
        :title="startLabel"
        :disabled="busy"
        @click.stop="start"
      >
        <Play :size="13" aria-hidden="true" />
      </button>
      <button
        v-if="canSuspend"
        type="button"
        class="grid size-6 place-items-center rounded text-base-content/55 hover:bg-base-300/70 hover:text-warning disabled:opacity-50"
        :aria-label="suspendLabel"
        :title="suspendLabel"
        :disabled="busy"
        @click.stop="suspend"
      >
        <Pause :size="13" aria-hidden="true" />
      </button>
      <button
        v-if="canWait"
        type="button"
        class="grid size-6 place-items-center rounded text-base-content/55 hover:bg-base-300/70 hover:text-primary disabled:opacity-50"
        :aria-label="waitLabel"
        :title="waitLabel"
        :disabled="busy"
        @click.stop="wait"
      >
        <Hourglass :size="13" aria-hidden="true" />
      </button>
    </span>

    <ul v-if="expanded" :id="subtasksId" class="col-span-full mt-1 mb-0.5 space-y-0.5 pl-8">
      <li v-for="(child, index) in task.children" :key="child.id">
        <button
          type="button"
          class="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-base-200/70 disabled:opacity-60"
          :aria-label="child.title"
          :disabled="busy || readonly"
          @click.stop="toggleSubtask(child.id)"
        >
          <span class="w-3 shrink-0 text-[11px] tabular-nums text-base-content/45">{{
            index + 1
          }}</span>
          <span
            class="grid size-3.5 shrink-0 place-items-center rounded-full border-[1.5px]"
            :class="
              child.status === 'done'
                ? 'border-primary bg-primary'
                : current?.id === child.id
                  ? 'border-primary/60'
                  : 'border-base-content/25'
            "
          ></span>
          <span
            class="truncate text-[12px]"
            :class="{ 'text-base-content/55 line-through': child.status === 'done' }"
            >{{ child.title }}</span
          >
          <span v-if="current?.id === child.id" class="text-[11.5px] text-primary">{{
            t("task.current")
          }}</span>
        </button>
      </li>
    </ul>
  </motion.li>
</template>

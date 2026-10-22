<script setup lang="ts">
import { Pause, Play } from "@lucide/vue";
import { motion } from "motion-v";
import { computed, ref } from "vue";
import { shortDate, todayIso } from "../../lib/dates";
import { askSuspend } from "../../lib/dialog";
import { t } from "../../lib/i18n";
import { listItemMotion } from "../../lib/motion";
import { daysSince, overdueDays } from "../../model/mappers";
import type { Task } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { taskRowVM } from "../../viewmodels/taskRowVM";
import StatusDot from "./StatusDot.vue";

const props = defineProps<{
  task: Task;
  plan?: { end: string; spans: boolean; conflict: boolean };
  dropLine?: boolean;
}>();
const emit = defineEmits<{ open: [Task]; changed: [] }>();

const category = computed(
  () => appVM.state.categories.find((c) => c.id === props.task.categoryId)?.name ?? null,
);
const owner = computed(
  () => appVM.state.people.find((p) => p.id === props.task.ownerId)?.name ?? null,
);
const stepsDone = computed(() => props.task.steps.filter((s) => s.done).length);
const late = computed(() => overdueDays(props.task.dueDate, todayIso()));
const overdue = computed(() => late.value > 0 && props.task.status !== "done");
const conflictTitle = computed(() =>
  t("task.conflictTitle", {
    date: shortDate(props.plan?.end ?? null),
    due: shortDate(props.task.dueDate),
  }),
);

const busy = ref(false);
const hasSteps = computed(() => props.task.steps.length > 0);
const isDone = computed(() => props.task.status === "done");
const canStart = computed(
  () => !hasSteps.value && !isDone.value && (props.task.status === "todo" || props.task.suspended),
);
const canSuspend = computed(() => !isDone.value && !props.task.suspended);
const doneLabel = computed(() =>
  t(isDone.value ? "task.reopenAria" : "task.doneAria", { title: props.task.title }),
);
const startLabel = computed(() => t("task.startAria", { title: props.task.title }));
const suspendLabel = computed(() => t("task.suspendAria", { title: props.task.title }));
const suspendedBadge = computed(() =>
  props.task.suspendedAt
    ? t("task.suspendedFor", { days: daysSince(props.task.suspendedAt, todayIso()) })
    : t("task.suspendedNoDate"),
);

async function run(action: () => Promise<unknown>): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    await action();
    emit("changed");
  } catch {
    // A row has no error slot; leave it as it was and let the next load win.
  } finally {
    busy.value = false;
  }
}

function toggleDone(): void {
  if (hasSteps.value) return;
  void run(() => taskRowVM.toggleDone(props.task));
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

async function suspend(): Promise<void> {
  if (busy.value) return;
  busy.value = true;
  try {
    const draft = await askSuspend(t("task.suspendAria", { title: props.task.title }));
    if (!draft) return;
    await taskRowVM.suspend(props.task, draft.until || null, draft.reason || null);
    emit("changed");
  } catch {
    // Same as run: the next load shows the real state.
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <motion.li
    v-bind="listItemMotion"
    class="relative flex cursor-pointer items-center gap-2.5 rounded-xl bg-base-100 px-3 py-3 transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary/40"
    tabindex="0"
    @click="onRowClick"
    @keydown.enter="onRowKey"
  >
    <span
      v-if="dropLine"
      class="pointer-events-none absolute -top-1 right-2 left-2 h-0.5 rounded-full bg-primary"
    ></span>
    <slot name="leading" />
    <button
      v-if="!hasSteps"
      class="flex shrink-0 rounded-full disabled:opacity-60"
      :aria-label="doneLabel"
      :title="doneLabel"
      :disabled="busy"
      @click.stop="toggleDone"
    >
      <StatusDot :status="task.status" />
    </button>
    <span v-else class="shrink-0" :title="t('task.stepsHint')" @click.stop>
      <StatusDot :status="task.status" />
    </span>
    <span
      class="text-[13px]"
      :class="{ 'text-base-content/40 line-through': task.status === 'done' }"
    >
      {{ task.title }}
    </span>
    <span v-if="category" class="badge badge-ghost badge-xs">{{ category }}</span>
    <span v-if="task.priority === 'high'" class="badge badge-soft badge-warning badge-xs">
      {{ t("task.priorityHigh") }}
    </span>
    <span v-if="task.steps.length" class="text-[10px] text-base-content/40">
      {{ stepsDone }}/{{ task.steps.length }}
    </span>
    <span v-if="task.effortDays !== 1" class="badge badge-ghost badge-xs">
      {{ t("task.effortDays", { days: task.effortDays }) }}
    </span>
    <span
      v-if="task.exclusive"
      class="badge badge-soft badge-accent badge-xs"
      :title="t('task.exclusiveHint')"
    >
      {{ t("task.exclusive") }}
    </span>
    <span v-if="plan?.spans" class="text-[10px] text-base-content/40">
      {{ t("task.plannedEnd", { date: shortDate(plan.end) }) }}
    </span>
    <span v-if="task.carryCount" class="badge badge-soft badge-warning badge-xs">
      {{ t("task.carry", { count: task.carryCount }) }}
    </span>
    <span
      v-if="task.suspended"
      class="badge badge-ghost badge-xs"
      :title="task.suspendReason ?? undefined"
    >
      {{ suspendedBadge }}
    </span>
    <span v-if="task.suspended && task.suspendedUntil" class="badge badge-ghost badge-xs">
      {{ t("task.suspended", { date: shortDate(task.suspendedUntil) }) }}
    </span>
    <span v-if="overdue" class="badge badge-soft badge-error badge-xs">{{
      t("task.overdue", { days: late })
    }}</span>
    <span
      v-if="plan?.conflict"
      class="badge badge-soft badge-error badge-xs"
      :title="conflictTitle"
    >
      {{ t("task.notFit") }}
    </span>
    <span class="ml-auto text-[11px] text-base-content/45">{{ owner }}</span>
    <span
      v-if="task.dueDate"
      class="w-11 text-right text-[11px]"
      :class="overdue ? 'text-error' : 'text-base-content/45'"
    >
      {{ shortDate(task.dueDate) }}
    </span>
    <div class="flex shrink-0 items-center gap-0.5">
      <button
        v-if="canStart"
        class="grid size-5 place-items-center rounded-md text-base-content/30 hover:bg-base-200 hover:text-primary disabled:opacity-50"
        :aria-label="startLabel"
        :title="startLabel"
        :disabled="busy"
        @click.stop="start"
      >
        <Play :size="13" aria-hidden="true" />
      </button>
      <button
        v-if="canSuspend"
        class="grid size-5 place-items-center rounded-md text-base-content/30 hover:bg-base-200 hover:text-warning disabled:opacity-50"
        :aria-label="suspendLabel"
        :title="suspendLabel"
        :disabled="busy"
        @click.stop="suspend"
      >
        <Pause :size="13" aria-hidden="true" />
      </button>
    </div>
  </motion.li>
</template>

<script setup lang="ts">
import { ChevronRight, Pause, Play } from "@lucide/vue";
import { motion } from "motion-v";
import { computed, ref } from "vue";
import { shortDate, todayIso } from "../../lib/dates";
import { askNotice, askSuspend } from "../../lib/dialog";
import { formatEffort } from "../../lib/effort";
import { errorText, t } from "../../lib/i18n";
import { listItemMotion } from "../../lib/motion";
import { canSuspendTask } from "../../lib/status";
import { currentStep, stepLabel, stepsDone } from "../../lib/steps";
import { daysSince, overdueDays } from "../../model/mappers";
import type { Task } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { taskRowVM } from "../../viewmodels/taskRowVM";
import PriorityBadge from "./PriorityBadge.vue";
import StatusDot from "./StatusDot.vue";

const props = withDefaults(
  defineProps<{
    task: Task;
    plan?: { end: string; spans: boolean; conflict: boolean };
    dropLine?: boolean;
    showProject?: boolean;
    draggable?: boolean;
  }>(),
  { showProject: true, draggable: false },
);
const emit = defineEmits<{
  open: [Task];
  changed: [];
  dragStart: [DragEvent, Task];
  dragEnd: [];
}>();

const category = computed(
  () => appVM.state.categories.find((c) => c.id === props.task.categoryId)?.name ?? null,
);
const owner = computed(
  () => appVM.state.people.find((p) => p.id === props.task.ownerId)?.name ?? null,
);
const done = computed(() => stepsDone(props.task.steps));
const current = computed(() => currentStep(props.task.steps));
const stepLine = computed(() => stepLabel(props.task.steps));
const stepsId = computed(() => `steps-${props.task.id}`);
const late = computed(() => overdueDays(props.task.dueDate, todayIso()));
const overdue = computed(() => late.value > 0 && props.task.status !== "done");
const conflictTitle = computed(() =>
  t("task.conflictTitle", {
    date: shortDate(props.plan?.end ?? null),
    due: shortDate(props.task.dueDate),
  }),
);

const busy = ref(false);
const expanded = ref(false);
const hasSteps = computed(() => props.task.steps.length > 0);
const isDone = computed(() => props.task.status === "done");
const canStart = computed(
  () => !hasSteps.value && !isDone.value && (props.task.status === "todo" || props.task.suspended),
);
const canSuspend = computed(() => canSuspendTask(props.task));
const doneLabel = computed(() =>
  t(isDone.value ? "task.reopenAria" : "task.doneAria", { title: props.task.title }),
);
const startLabel = computed(() => t("task.startAria", { title: props.task.title }));
const suspendLabel = computed(() => t("task.suspendAria", { title: props.task.title }));
const stepsLabel = computed(() => t(expanded.value ? "task.collapseSteps" : "task.expandSteps"));
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
  } catch (e) {
    void askNotice(t("common.actionFailed"), errorText(e));
  } finally {
    busy.value = false;
  }
}

function toggleDone(): void {
  if (hasSteps.value) return;
  void run(() => taskRowVM.toggleDone(props.task));
}

function toggleStep(stepId: string): void {
  void run(() => taskRowVM.toggleStepDone(stepId));
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
    v-bind="listItemMotion"
    class="relative cursor-pointer rounded-xl bg-base-100 px-3 py-3 focus-visible:ring-2 focus-visible:ring-primary/40"
    :class="{ 'transition-opacity hover:opacity-90': !hasSteps }"
    :draggable="draggable"
    tabindex="0"
    @click="onRowClick"
    @keydown.enter="onRowKey"
    @dragstart="emit('dragStart', $event, task)"
    @dragend="emit('dragEnd')"
  >
    <span
      v-if="dropLine"
      class="pointer-events-none absolute -top-1 right-2 left-2 h-0.5 rounded-full bg-primary"
    ></span>
    <div class="flex items-start gap-2.5">
      <slot name="leading" />
      <button
        v-if="!hasSteps"
        class="mt-0.5 flex shrink-0 rounded-full disabled:opacity-60"
        :aria-label="doneLabel"
        :title="doneLabel"
        :disabled="busy"
        @click.stop="toggleDone"
      >
        <StatusDot :status="task.status" :suspended="task.suspended" />
      </button>
      <span v-else class="mt-0.5 shrink-0" :title="t('task.stepsHint')" @click.stop>
        <StatusDot :status="task.status" :suspended="task.suspended" />
      </span>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2.5">
          <span
            class="text-[13px]"
            :class="{ 'text-base-content/40 line-through': task.status === 'done' }"
          >
            {{ task.title }}
          </span>
          <span
            v-if="showProject && task.projectName"
            class="badge badge-soft badge-primary badge-xs max-w-32"
            :title="task.projectName"
          >
            <span class="min-w-0 truncate">{{ task.projectName }}</span>
          </span>
          <span v-if="category" class="badge badge-ghost badge-xs">{{ category }}</span>
          <PriorityBadge :priority="task.priority" />
          <button
            v-if="hasSteps"
            type="button"
            class="flex items-center gap-0.5 rounded-md px-1 py-0.5 text-[10px] text-base-content/40 hover:bg-base-200"
            :aria-expanded="expanded"
            :aria-controls="expanded ? stepsId : undefined"
            :title="stepsLabel"
            :aria-label="stepsLabel"
            @click.stop="toggleExpanded"
          >
            {{ done }}/{{ task.steps.length }}
            <ChevronRight
              :size="11"
              aria-hidden="true"
              class="transition-transform duration-200"
              :class="{ 'rotate-90': expanded }"
            />
          </button>
          <span v-if="task.effortMinutes !== 480" class="badge badge-ghost badge-xs">
            {{ formatEffort(task.effortMinutes) }}
          </span>
          <span
            v-if="!task.exclusive"
            class="badge badge-ghost badge-xs"
            :title="t('task.sharedHint')"
          >
            {{ t("task.shared") }}
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
            class="text-right text-[11px]"
            :class="[
              overdue ? 'text-error' : 'text-base-content/45',
              task.dueTime ? 'w-20' : 'w-11',
            ]"
          >
            {{ shortDate(task.dueDate) }}
            <span v-if="task.dueTime" class="text-[10px]">{{ task.dueTime }}</span>
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
        </div>
        <p
          v-if="stepLine && !expanded"
          class="truncate text-[10.5px] leading-4 text-base-content/45"
        >
          {{ stepLine }}
        </p>
        <ul v-if="expanded" :id="stepsId" class="mt-1 mb-0.5 space-y-0.5">
          <li v-for="(step, index) in task.steps" :key="step.id">
            <button
              type="button"
              class="flex w-full items-center gap-2 rounded-lg px-1 py-0.5 text-left hover:bg-base-200 disabled:opacity-60"
              :aria-label="step.title"
              :disabled="busy"
              @click.stop="toggleStep(step.id)"
            >
              <span class="w-3 shrink-0 text-[10px] tabular-nums text-base-content/30">{{
                index + 1
              }}</span>
              <span
                class="grid size-3.5 shrink-0 place-items-center rounded-full border-[1.5px]"
                :class="
                  step.done
                    ? 'border-success bg-success'
                    : current?.id === step.id
                      ? 'border-primary/60'
                      : 'border-base-content/25'
                "
              ></span>
              <span
                class="truncate text-[11px]"
                :class="{ 'text-base-content/40 line-through': step.done }"
                >{{ step.title }}</span
              >
              <span
                v-if="current?.id === step.id"
                class="badge badge-ghost badge-xs text-primary"
                >{{ t("task.current") }}</span
              >
            </button>
          </li>
        </ul>
      </div>
    </div>
  </motion.li>
</template>

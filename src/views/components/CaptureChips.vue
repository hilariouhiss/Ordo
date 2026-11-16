<script setup lang="ts">
import { computed } from "vue";
import type { CaptureField } from "../../lib/capture";
import { shortDate, weekdayLabel } from "../../lib/dates";
import { t } from "../../lib/i18n";
import type { CaptureFields, Priority } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import ChipSelect from "./ChipSelect.vue";
import DateField from "./DateField.vue";
import EffortField from "./EffortField.vue";

const props = defineProps<{
  fields: CaptureFields;
  matched: CaptureField[];
  /** The day the plan counts from; today when the start is left empty. */
  expectedStart: string;
  /** The working day the estimate needs; shown read-only next to the chips. */
  finish: string;
  /** The day a started or finished line began; today when left empty. */
  actualStart: string;
  /** The day a finished line ended, measured from its actual start and effort. */
  actualFinish: string;
  /** Recording a finished line: the estimate becomes the time it took. */
  done: boolean;
  /** A `#name` that will become a project when the line is saved. */
  newProjectName: string | null;
}>();
const emit = defineEmits<{ edit: [patch: Partial<CaptureFields>] }>();

/** Stands in for a #name that does not exist yet, so the select can show it as chosen. */
const PENDING_PROJECT = "__new_project__";

const projectOptions = computed(() => {
  const list = appVM.state.projects.map((project) => ({
    value: project.id,
    label: project.name,
  }));
  list.unshift({ value: "", label: t("task.noProject") });
  if (props.newProjectName) {
    list.splice(1, 0, { value: PENDING_PROJECT, label: props.newProjectName });
  }
  const current = props.fields.projectId;
  if (current && !list.some((option) => option.value === current)) {
    list.splice(1, 0, { value: current, label: t("common.project") });
  }
  return list;
});

const ownerOptions = computed(() => [
  { value: "", label: t("capture.ownerDefault") },
  ...appVM.state.people.map((person) => ({ value: person.id, label: person.name })),
]);

const priorityOptions = computed(() => [
  { value: "high", label: t("task.priorityHigh") },
  { value: "normal", label: t("task.priorityNormal") },
  { value: "low", label: t("task.priorityLow") },
]);

const finishLabel = computed(() => `${shortDate(props.finish)} ${weekdayLabel(props.finish)}`);
const actualFinishLabel = computed(() =>
  props.actualFinish ? `${shortDate(props.actualFinish)} ${weekdayLabel(props.actualFinish)}` : "",
);

function controlClass(field: CaptureField): string {
  return props.matched.includes(field) ? "text-primary" : "text-base-content";
}

function onProject(value: string): void {
  // Picking the pending name keeps it; picking anything else replaces it.
  if (value === PENDING_PROJECT) return;
  emit("edit", { projectId: value || null });
}

function onOwner(value: string): void {
  emit("edit", { ownerId: value || null });
}

function onPriority(value: string): void {
  emit("edit", { priority: value as Priority });
}

/** The plan starts where it was told; an empty day leaves the finish counting from today. */
function onExpectedStart(value: string): void {
  emit("edit", { expectedStartDate: value || null });
}

function onActualStart(value: string): void {
  emit("edit", { actualStartDate: value || null });
}

/** Effort is minutes; the field commits on blur, so the capture box keeps focus. */
const effort = computed({
  get: () => props.fields.effortMinutes,
  set: (value: number) => emit("edit", { effortMinutes: value }),
});
</script>

<template>
  <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
    <label class="flex min-w-0 items-center gap-1">
      <span class="shrink-0 text-base-content/60">{{ t("task.project") }}</span>
      <ChipSelect
        :model-value="newProjectName ? PENDING_PROJECT : (fields.projectId ?? '')"
        :options="projectOptions"
        :label="t('task.project')"
        :class="newProjectName ? 'text-primary' : controlClass('projectId')"
        class="select select-xs max-w-[120px] rounded-md border-base-300 bg-base-100 pl-1! text-[12px]"
        @update:model-value="onProject"
      />
    </label>

    <label class="flex min-w-0 items-center gap-1">
      <span class="shrink-0 text-base-content/60">{{ t("task.owner") }}</span>
      <ChipSelect
        :model-value="fields.ownerId ?? ''"
        :options="ownerOptions"
        :label="t('task.owner')"
        :class="controlClass('ownerId')"
        class="select select-xs max-w-[104px] rounded-md border-base-300 bg-base-100 pl-1! text-[12px]"
        @update:model-value="onOwner"
      />
    </label>

    <label class="flex items-center gap-1">
      <span class="shrink-0 text-base-content/60">{{ t("capture.priority") }}</span>
      <ChipSelect
        :model-value="fields.priority"
        :options="priorityOptions"
        :label="t('capture.priority')"
        :class="controlClass('priority')"
        class="select select-xs max-w-[96px] rounded-md border-base-300 bg-base-100 pl-1! text-[12px]"
        @update:model-value="onPriority"
      />
    </label>

    <label class="flex min-w-0 items-center gap-1">
      <span class="shrink-0 text-base-content/60">{{
        t(done ? "task.startDate" : "task.expectedStart")
      }}</span>
      <DateField
        v-if="done"
        :model-value="actualStart"
        class="h-6 w-[104px] rounded-md border border-base-300 bg-base-100 px-1.5 text-[12px]"
        @update:model-value="onActualStart"
      />
      <DateField
        v-else
        :model-value="expectedStart"
        class="h-6 w-[104px] rounded-md border border-base-300 bg-base-100 px-1.5 text-[12px]"
        @update:model-value="onExpectedStart"
      />
    </label>

    <label class="flex items-center gap-1">
      <span class="shrink-0 text-base-content/60">{{
        t(done ? "task.actualEffort" : "capture.effort")
      }}</span>
      <EffortField
        v-model="effort"
        compact
        :label="t(done ? 'task.actualEffort' : 'capture.effort')"
        :class="controlClass('effortMinutes')"
      />
    </label>

    <span class="flex items-center gap-1 text-base-content/60">
      {{ t(done ? "task.actualFinish" : "task.expectedFinish") }}
      <span class="tabular-nums text-base-content/70">{{
        done ? actualFinishLabel : finishLabel
      }}</span>
    </span>
  </div>
</template>

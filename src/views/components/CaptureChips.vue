<script setup lang="ts">
import { computed, ref } from "vue";
import type { CaptureField } from "../../lib/capture";
import { errorText, t } from "../../lib/i18n";
import type { CaptureFields, Priority } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { projectsVM } from "../../viewmodels/projectsVM";
import ChipSelect from "./ChipSelect.vue";
import DateField from "./DateField.vue";
import EffortField from "./EffortField.vue";

const props = defineProps<{
  fields: CaptureFields;
  matched: CaptureField[];
}>();
const emit = defineEmits<{ edit: [patch: Partial<CaptureFields>] }>();
const error = ref("");

/** A name typed at the end of the project list creates that project and picks it. */
async function onCreateProject(name: string): Promise<void> {
  error.value = "";
  try {
    const project = await projectsVM.create(name);
    if (project) emit("edit", { projectId: project.id });
  } catch (e) {
    error.value = errorText(e);
  }
}

const projectOptions = computed(() => {
  const list = appVM.state.projects.map((project) => ({
    value: project.id,
    label: project.name,
  }));
  list.unshift({ value: "", label: t("task.noProject") });
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

function controlClass(field: CaptureField): string {
  return props.matched.includes(field) ? "text-primary" : "text-base-content";
}

function onProject(value: string): void {
  emit("edit", { projectId: value || null });
}

function onOwner(value: string): void {
  emit("edit", { ownerId: value || null });
}

function onPriority(value: string): void {
  emit("edit", { priority: value as Priority });
}

function onDue(value: string): void {
  emit("edit", { dueDate: value || null });
}

/** Effort is minutes; the field commits on blur, so the capture box keeps focus. */
const effort = computed({
  get: () => props.fields.effortMinutes,
  set: (value: number) => emit("edit", { effortMinutes: value }),
});
</script>

<template>
  <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]">
    <label class="flex min-w-0 items-center gap-1">
      <span class="shrink-0 text-base-content/40">{{ t("task.project") }}</span>
      <ChipSelect
        :model-value="fields.projectId ?? ''"
        :options="projectOptions"
        :label="t('task.project')"
        :create-placeholder="t('projects.placeholder')"
        :class="controlClass('projectId')"
        class="select select-xs max-w-[120px] rounded-md border-base-300 bg-base-100 pl-1! text-[10.5px]"
        @update:model-value="onProject"
        @create="onCreateProject"
      />
    </label>

    <label class="flex min-w-0 items-center gap-1">
      <span class="shrink-0 text-base-content/40">{{ t("task.owner") }}</span>
      <ChipSelect
        :model-value="fields.ownerId ?? ''"
        :options="ownerOptions"
        :label="t('task.owner')"
        :class="controlClass('ownerId')"
        class="select select-xs max-w-[104px] rounded-md border-base-300 bg-base-100 pl-1! text-[10.5px]"
        @update:model-value="onOwner"
      />
    </label>

    <label class="flex items-center gap-1">
      <span class="shrink-0 text-base-content/40">{{ t("capture.priority") }}</span>
      <ChipSelect
        :model-value="fields.priority"
        :options="priorityOptions"
        :label="t('capture.priority')"
        :class="controlClass('priority')"
        class="select select-xs max-w-[96px] rounded-md border-base-300 bg-base-100 pl-1! text-[10.5px]"
        @update:model-value="onPriority"
      />
    </label>

    <label class="flex items-center gap-1">
      <span class="shrink-0 text-base-content/40">{{ t("task.due") }}</span>
      <DateField
        :model-value="fields.dueDate ?? ''"
        :class="controlClass('dueDate')"
        class="input input-xs w-[112px] rounded-md border-base-300 text-[10.5px]"
        @update:model-value="onDue"
      />
    </label>

    <label class="flex items-center gap-1">
      <span class="shrink-0 text-base-content/40">{{ t("capture.effort") }}</span>
      <EffortField v-model="effort" compact :class="controlClass('effortMinutes')" />
    </label>

    <p v-if="error" class="basis-full text-[10.5px] text-error">{{ error }}</p>
  </div>
</template>

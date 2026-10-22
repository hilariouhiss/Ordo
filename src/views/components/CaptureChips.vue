<script setup lang="ts">
import { computed } from "vue";
import { validEffort, type CaptureField } from "../../lib/capture";
import { t } from "../../lib/i18n";
import type { CaptureFields, Priority } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";

const props = defineProps<{
  fields: CaptureFields;
  matched: CaptureField[];
}>();
const emit = defineEmits<{ edit: [patch: Partial<CaptureFields>] }>();

const projectOptions = computed(() => {
  const list = appVM.state.projects.map((project) => ({ id: project.id, name: project.name }));
  const current = props.fields.projectId;
  if (current && !list.some((project) => project.id === current)) {
    list.unshift({ id: current, name: t("common.project") });
  }
  return list;
});

function controlClass(field: CaptureField): string {
  return props.matched.includes(field) ? "text-primary" : "text-base-content";
}

function onProject(event: Event): void {
  emit("edit", { projectId: (event.target as HTMLSelectElement).value || null });
}

function onOwner(event: Event): void {
  emit("edit", { ownerId: (event.target as HTMLSelectElement).value || null });
}

function onPriority(event: Event): void {
  emit("edit", { priority: (event.target as HTMLSelectElement).value as Priority });
}

function onDue(event: Event): void {
  emit("edit", { dueDate: (event.target as HTMLInputElement).value || null });
}

function onEffort(event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  if (validEffort(value)) {
    emit("edit", { effortDays: value });
  } else {
    input.value = String(props.fields.effortDays);
  }
}
</script>

<template>
  <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]">
    <label class="flex min-w-0 items-center gap-1">
      <span class="shrink-0 text-base-content/40">{{ t("task.project") }}</span>
      <select
        :value="fields.projectId ?? ''"
        :class="controlClass('projectId')"
        class="h-5 max-w-[110px] truncate rounded border border-base-300 bg-base-100 px-0.5 text-[10.5px] outline-none"
        @change="onProject"
      >
        <option value="">{{ t("task.noProject") }}</option>
        <option v-for="project in projectOptions" :key="project.id" :value="project.id">
          {{ project.name }}
        </option>
      </select>
    </label>

    <label class="flex min-w-0 items-center gap-1">
      <span class="shrink-0 text-base-content/40">{{ t("task.owner") }}</span>
      <select
        :value="fields.ownerId ?? ''"
        :class="controlClass('ownerId')"
        class="h-5 max-w-[90px] truncate rounded border border-base-300 bg-base-100 px-0.5 text-[10.5px] outline-none"
        @change="onOwner"
      >
        <option value="">{{ t("capture.ownerDefault") }}</option>
        <option v-for="person in appVM.state.people" :key="person.id" :value="person.id">
          {{ person.name }}
        </option>
      </select>
    </label>

    <label class="flex items-center gap-1">
      <span class="shrink-0 text-base-content/40">{{ t("capture.priority") }}</span>
      <select
        :value="fields.priority"
        :class="controlClass('priority')"
        class="h-5 rounded border border-base-300 bg-base-100 px-0.5 text-[10.5px] outline-none"
        @change="onPriority"
      >
        <option value="high">{{ t("task.priorityHigh") }}</option>
        <option value="normal">{{ t("task.priorityNormal") }}</option>
        <option value="low">{{ t("task.priorityLow") }}</option>
      </select>
    </label>

    <label class="flex items-center gap-1">
      <span class="shrink-0 text-base-content/40">{{ t("task.due") }}</span>
      <input
        type="date"
        :value="fields.dueDate ?? ''"
        :class="controlClass('dueDate')"
        class="h-5 w-[100px] rounded border border-base-300 bg-base-100 px-0.5 text-[10.5px] outline-none"
        @change="onDue"
      />
    </label>

    <label class="flex items-center gap-1">
      <span class="shrink-0 text-base-content/40">{{ t("capture.effort") }}</span>
      <input
        type="number"
        min="0.5"
        max="60"
        step="0.5"
        :value="fields.effortDays"
        :class="controlClass('effortDays')"
        class="h-5 w-11 rounded border border-base-300 bg-base-100 px-0.5 text-[10.5px] outline-none"
        @change="onEffort"
      />
      <span class="text-base-content/40">{{ t("capture.effortUnit") }}</span>
    </label>
  </div>
</template>

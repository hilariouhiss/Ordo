<script setup lang="ts">
import { computed } from "vue";
import { stepEffort, validEffort, type CaptureField } from "../../lib/capture";
import { t } from "../../lib/i18n";
import type { CaptureFields, Priority } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import ChipSelect from "./ChipSelect.vue";
import DateField from "./DateField.vue";

const props = defineProps<{
  fields: CaptureFields;
  matched: CaptureField[];
}>();
const emit = defineEmits<{ edit: [patch: Partial<CaptureFields>] }>();

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

function onEffort(event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  if (validEffort(value)) {
    emit("edit", { effortDays: value });
  } else {
    input.value = String(props.fields.effortDays);
  }
}

// Native number stepping drops the caret at the end; step a text field instead.
function onEffortKey(event: KeyboardEvent): void {
  if (event.isComposing || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
  event.preventDefault();
  const input = event.currentTarget as HTMLInputElement;
  const parsed = Number(input.value);
  const base =
    input.value.trim() !== "" && Number.isFinite(parsed) ? parsed : props.fields.effortDays;
  const next = stepEffort(base, event.key === "ArrowUp" ? 1 : -1);
  const caret = input.selectionStart ?? input.value.length;
  const atEnd = caret === input.value.length && (input.selectionEnd ?? caret) === caret;
  input.value = String(next);
  const pos = atEnd ? input.value.length : Math.min(caret, input.value.length);
  input.setSelectionRange(pos, pos);
}

/** Blur commits a stepped value; emitting per arrow press would pull focus back to the capture box. */
function commitEffort(event: Event): void {
  const input = event.target as HTMLInputElement;
  if (input.value === String(props.fields.effortDays)) return;
  onEffort(event);
}
</script>

<template>
  <div class="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px]">
    <label class="flex min-w-0 items-center gap-1">
      <span class="shrink-0 text-base-content/40">{{ t("task.project") }}</span>
      <ChipSelect
        :model-value="fields.projectId ?? ''"
        :options="projectOptions"
        :label="t('task.project')"
        :class="controlClass('projectId')"
        class="select select-xs max-w-[120px] rounded-md border-base-300 bg-base-100 pl-1! text-[10.5px]"
        @update:model-value="onProject"
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
      <input
        type="text"
        inputmode="decimal"
        :value="String(fields.effortDays)"
        :class="controlClass('effortDays')"
        class="field-sizing-content h-6 min-w-7 rounded-md border border-base-300 bg-base-100 px-1 text-center text-[10.5px] outline-none"
        @keydown="onEffortKey"
        @blur="commitEffort"
      />
      <span class="text-base-content/40">{{ t("capture.effortUnit") }}</span>
    </label>
  </div>
</template>

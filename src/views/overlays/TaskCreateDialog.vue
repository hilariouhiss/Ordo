<script setup lang="ts">
import { X } from "@lucide/vue";
import { motion } from "motion-v";
import { computed, nextTick, onMounted, onUnmounted, ref } from "vue";
import { shortDate, weekdayLabel } from "../../lib/dates";
import { errorText, t, type MessageKey } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { backdropMotion, modalPanelMotion } from "../../lib/motion";
import type { Priority, Status } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { taskCreateVM } from "../../viewmodels/taskCreateVM";
import ChipSelect from "../components/ChipSelect.vue";
import DateField from "../components/DateField.vue";
import EffortField from "../components/EffortField.vue";
import StatusDot from "../components/StatusDot.vue";

const statusOptions: { value: Status; key: MessageKey }[] = [
  { value: "todo", key: "task.statusTodo" },
  { value: "doing", key: "task.statusDoing" },
  { value: "done", key: "task.statusDone" },
];

const form = computed(() => taskCreateVM.state.form);
const titleInput = ref<HTMLInputElement | null>(null);
const tagDraft = ref("");

const projectOptions = computed(() => [
  { value: "", label: t("task.noProject") },
  ...appVM.state.projects.map((project) => ({ value: project.id, label: project.name })),
]);
const categoryOptions = computed(() => [
  { value: "", label: t("common.uncategorized") },
  ...[...appVM.state.categories]
    .sort((one, other) => one.sortOrder - other.sortOrder)
    .map((category) => ({ value: category.id, label: category.name })),
]);
const ownerOptions = computed(() => [
  { value: "", label: t("capture.ownerDefault") },
  ...appVM.state.people.map((person) => ({ value: person.id, label: person.name })),
]);
const priorityOptions = computed(() => [
  { value: "high", label: t("task.priorityHigh") },
  { value: "normal", label: t("task.priorityNormal") },
  { value: "low", label: t("task.priorityLow") },
]);

const expectedFinishLabel = computed(() => {
  const day = taskCreateVM.expectedFinish.value;
  return day ? `${shortDate(day)} ${weekdayLabel(day)}` : "";
});
const actualFinishLabel = computed(() => {
  const day = taskCreateVM.actualFinish.value;
  return day ? `${shortDate(day)} ${weekdayLabel(day)}` : "";
});

function close(): void {
  if (!taskCreateVM.state.busy) taskCreateVM.close();
}

function save(): void {
  void taskCreateVM.save();
}

/** Enter in the one-line title submits, the same as the capture box. */
function onTitleKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  save();
}

function addTag(): void {
  const name = tagDraft.value.trim();
  const lower = name.toLowerCase();
  if (!name || form.value.tags.some((tag) => tag.toLowerCase() === lower)) return;
  form.value.tags.push(name);
  tagDraft.value = "";
}

function removeTag(name: string): void {
  form.value.tags = form.value.tags.filter((tag) => tag !== name);
}

function onTagKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  addTag();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  void nextTick(() => titleInput.value?.focus());
});
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <motion.div
    v-bind="backdropMotion"
    class="window-scrim fixed inset-0 z-[80] flex items-center justify-center bg-neutral/40 p-4"
    @click.self="close"
  >
    <motion.div
      v-bind="modalPanelMotion"
      role="dialog"
      aria-modal="true"
      :aria-label="t('quickCreate.taskTitle')"
      class="flex max-h-[86vh] w-full max-w-[560px] flex-col overflow-hidden rounded-2xl bg-base-100 shadow-2xl"
    >
      <div class="flex shrink-0 items-center px-4 pt-4">
        <h2 class="text-[14px] font-semibold">{{ t("quickCreate.taskTitle") }}</h2>
        <button
          class="ml-auto grid size-6 place-items-center rounded-md text-base-content/60 hover:bg-base-200 hover:text-base-content"
          :aria-label="t('common.close')"
          @click="close"
        >
          <X :size="15" aria-hidden="true" />
        </button>
      </div>

      <div class="min-h-0 overflow-y-auto px-4 pb-4">
        <input
          ref="titleInput"
          v-model="form.title"
          class="mt-2 w-full border-0 bg-transparent py-1 text-[18px] font-semibold tracking-[-0.01em] outline-none placeholder:text-base-content/40"
          :placeholder="t('task.title')"
          :aria-label="t('task.title')"
          @keydown.enter="onTitleKey"
        />

        <label class="mt-2 block text-[12px] text-base-content/65">
          {{ t("task.description") }}
          <textarea
            v-model="form.note"
            class="mt-1 h-[62px] w-full resize-none rounded-md border border-base-300 bg-base-100 px-2.5 py-1.5 text-[13px] leading-5 outline-none placeholder:text-base-content/55 focus:border-primary/60"
            rows="3"
            :placeholder="t('task.descriptionPlaceholder')"
          ></textarea>
        </label>

        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span class="mr-0.5 text-[12px] text-base-content/65">{{ t("task.status") }}</span>
          <button
            v-for="option in statusOptions"
            :key="option.value"
            type="button"
            class="flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px]"
            :class="
              form.status === option.value
                ? 'border-base-content/25 bg-base-300 font-medium text-base-content'
                : 'border-base-300 text-base-content/65 hover:text-base-content'
            "
            :aria-pressed="form.status === option.value"
            @click="form.status = option.value"
          >
            <StatusDot :status="option.value" />
            {{ t(option.key) }}
          </button>
        </div>

        <!-- One frame for the four attributes, the way the sheet draws them. -->
        <div
          class="mt-3 grid grid-cols-[1.15fr_0.85fr_0.8fr_0.6fr] text-[12px] text-base-content/65"
        >
          <span class="px-2.5">{{ t("task.project") }}</span>
          <span class="px-2.5">{{ t("task.category") }}</span>
          <span class="px-2.5">{{ t("task.owner") }}</span>
          <span class="px-2.5">{{ t("task.priority") }}</span>
        </div>
        <div class="mt-1 flex overflow-hidden rounded-md border border-base-300 bg-base-100">
          <ChipSelect
            :model-value="form.projectId ?? ''"
            :options="projectOptions"
            :label="t('task.project')"
            class="select-sm min-w-0 flex-[1.15] rounded-none border-0 pl-2.5"
            style="padding-inline: 10px 6px"
            @update:model-value="form.projectId = $event || null"
          />
          <ChipSelect
            :model-value="form.categoryId ?? ''"
            :options="categoryOptions"
            :label="t('task.category')"
            class="select-sm min-w-0 flex-[0.85] rounded-none border-0 border-l border-base-300 pl-2.5"
            style="padding-inline: 10px 6px"
            @update:model-value="form.categoryId = $event || null"
          />
          <ChipSelect
            :model-value="form.ownerId ?? ''"
            :options="ownerOptions"
            :label="t('task.owner')"
            class="select-sm min-w-0 flex-[0.8] rounded-none border-0 border-l border-base-300 pl-2.5"
            style="padding-inline: 10px 6px"
            @update:model-value="form.ownerId = $event || null"
          />
          <ChipSelect
            :model-value="form.priority"
            :options="priorityOptions"
            :label="t('task.priority')"
            class="select-sm min-w-0 flex-[0.6] rounded-none border-0 border-l border-base-300 pl-2.5"
            style="padding-inline: 10px 6px"
            @update:model-value="form.priority = $event as Priority"
          />
        </div>

        <div class="mt-3 grid grid-cols-[1fr_auto_1fr] items-start gap-x-2 gap-y-2">
          <label class="block text-[12px] text-base-content/65">
            {{ t("task.expectedStart") }}
            <DateField
              v-model="form.expectedStartDate"
              class="input input-sm mt-1 w-full rounded-md border-base-300"
            />
          </label>
          <label class="block text-[12px] text-base-content/65">
            {{ t("task.effort") }}
            <div class="mt-1">
              <EffortField v-model="form.effortMinutes" />
            </div>
          </label>
          <label class="block text-[12px] text-base-content/65">
            {{ t("task.expectedFinish") }}
            <span
              class="input input-sm mt-1 flex w-full items-center rounded-md border-base-300 bg-base-200/30 tabular-nums text-base-content/60"
            >
              {{ expectedFinishLabel }}
            </span>
          </label>

          <template v-if="form.status === 'doing'">
            <label class="col-span-3 block text-[12px] text-base-content/65">
              {{ t("task.startDate") }}
              <DateField
                v-model="form.actualStartDate"
                class="input input-sm mt-1 w-full rounded-md border-base-300"
              />
            </label>
          </template>
          <template v-else-if="form.status === 'done'">
            <label class="block text-[12px] text-base-content/65">
              {{ t("task.startDate") }}
              <DateField
                v-model="form.actualStartDate"
                class="input input-sm mt-1 w-full rounded-md border-base-300"
              />
            </label>
            <label class="block text-[12px] text-base-content/65">
              {{ t("task.actualEffort") }}
              <div class="mt-1">
                <EffortField v-model="form.actualEffortMinutes" :label="t('task.actualEffort')" />
              </div>
            </label>
            <label class="block text-[12px] text-base-content/65">
              {{ t("task.actualFinish") }}
              <span
                class="input input-sm mt-1 flex w-full items-center rounded-md border-base-300 bg-base-200/30 tabular-nums text-base-content/60"
              >
                {{ actualFinishLabel }}
              </span>
            </label>
          </template>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span class="text-[12px] text-base-content/65">{{ t("task.tags") }}</span>
          <span
            v-for="tag in form.tags"
            :key="tag"
            class="inline-flex h-6 items-center gap-1.5 rounded border border-base-300 px-2 text-[12px] text-base-content/70"
          >
            {{ tag }}
            <button
              class="text-base-content/30"
              :aria-label="t('task.removeTagAria')"
              @click="removeTag(tag)"
            >
              <X :size="12" aria-hidden="true" />
            </button>
          </span>
          <input
            v-model="tagDraft"
            class="input input-xs w-24 rounded-md border-dashed border-base-300 bg-transparent"
            :placeholder="t('task.addTag')"
            @keydown.enter="onTagKey"
          />
        </div>

        <p v-if="taskCreateVM.state.error" class="mt-2 text-[12px] text-error">
          {{ errorText(taskCreateVM.state.error) }}
        </p>
      </div>

      <div class="flex shrink-0 items-center justify-end gap-2 border-t border-base-200 px-4 py-3">
        <button
          type="button"
          class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
          @click="close"
        >
          {{ t("common.cancel") }}
        </button>
        <button
          type="button"
          class="btn btn-sm rounded-lg border-0 bg-base-content text-base-100"
          :disabled="taskCreateVM.state.busy || !form.title.trim()"
          @click="save"
        >
          {{ t("taskCreate.submit") }}
        </button>
      </div>
    </motion.div>
  </motion.div>
</template>

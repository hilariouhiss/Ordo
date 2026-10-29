<script setup lang="ts">
import { X } from "@lucide/vue";
import { motion } from "motion-v";
import { reactive, ref } from "vue";
import { errorText, t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { backdropMotion, modalPanelMotion } from "../../lib/motion";
import type { TaskAttrs, TaskTemplate, TemplateInput } from "../../model/types";
import { templatesVM } from "../../viewmodels/templatesVM";
import TaskAttrFields from "../components/TaskAttrFields.vue";

const props = defineProps<{ template: TaskTemplate | null }>();
const emit = defineEmits<{ close: [] }>();

const form = reactive({
  name: props.template?.name ?? "",
  note: props.template?.note ?? "",
});
const attrs = ref<TaskAttrs>({
  projectId: props.template?.projectId ?? null,
  categoryId: props.template?.categoryId ?? null,
  ownerId: props.template?.ownerId ?? null,
  priority: props.template?.priority ?? "normal",
  effortMinutes: props.template?.effortMinutes ?? 480,
  exclusive: props.template?.exclusive ?? false,
});
const steps = ref<string[]>([...(props.template?.steps ?? [])]);
const stepDraft = ref("");
const error = ref("");
const saving = ref(false);

function addStep(): void {
  const title = stepDraft.value.trim();
  if (!title) return;
  steps.value.push(title);
  stepDraft.value = "";
}

function onStepKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  addStep();
}

function removeStep(index: number): void {
  steps.value.splice(index, 1);
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const draft: TemplateInput = {
      id: props.template?.id ?? null,
      name: form.name,
      note: form.note.trim() || null,
      steps: steps.value,
      ...attrs.value,
    };
    await templatesVM.saveTemplate(draft);
    emit("close");
  } catch (e) {
    error.value = errorText(e);
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <motion.div
    v-bind="backdropMotion"
    class="fixed inset-0 z-[80] flex items-center justify-center bg-neutral/40 p-4"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <motion.div
      v-bind="modalPanelMotion"
      role="dialog"
      aria-modal="true"
      :aria-label="t(template ? 'template.editTitle' : 'template.newTitle')"
      class="max-h-[86vh] w-full max-w-[460px] overflow-y-auto rounded-2xl bg-base-100 p-4 shadow-2xl"
    >
      <div class="flex items-center">
        <h2 class="text-[14px] font-semibold">
          {{ t(template ? "template.editTitle" : "template.newTitle") }}
        </h2>
        <button
          class="ml-auto grid size-6 place-items-center rounded-md text-base-content/40 hover:bg-base-200 hover:text-base-content"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <X :size="15" aria-hidden="true" />
        </button>
      </div>

      <input
        v-model="form.name"
        class="input input-sm mt-3 w-full rounded-lg border-base-300 text-[12.5px]"
        :placeholder="t('template.namePlaceholder')"
        :aria-label="t('template.name')"
        autofocus
      />

      <TaskAttrFields v-model="attrs" />

      <div class="mt-3 text-[10.5px] font-medium tracking-wide text-base-content/40">
        {{ t("template.steps") }}
      </div>
      <ul class="mt-1 space-y-1">
        <li
          v-for="(step, index) in steps"
          :key="index"
          class="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-base-200"
        >
          <span class="w-3 text-[10px] text-base-content/30">{{ index + 1 }}</span>
          <span class="min-w-0 flex-1 truncate text-[12px]">{{ step }}</span>
          <button
            type="button"
            class="text-base-content/25"
            :aria-label="t('task.deleteStepAria')"
            @click="removeStep(index)"
          >
            <X :size="13" aria-hidden="true" />
          </button>
        </li>
      </ul>
      <input
        v-model="stepDraft"
        class="mt-1 w-full bg-transparent px-1 py-1.5 text-[12px] outline-none placeholder:text-base-content/35"
        :placeholder="t('template.stepPlaceholder')"
        :aria-label="t('template.steps')"
        @keydown.enter="onStepKey"
      />

      <label class="mt-3 block text-[11px] text-base-content/45">
        {{ t("template.note") }}
        <input v-model="form.note" class="input input-sm mt-1 w-full rounded-lg border-base-300" />
      </label>

      <p v-if="error" class="mt-2 text-[11px] text-error">{{ error }}</p>

      <div class="mt-4 flex justify-end gap-2">
        <button
          class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
          @click="emit('close')"
        >
          {{ t("common.cancel") }}
        </button>
        <button
          class="btn btn-sm rounded-lg border-0 bg-primary text-primary-content"
          :disabled="saving || !form.name.trim()"
          @click="save"
        >
          {{ t("common.save") }}
        </button>
      </div>
    </motion.div>
  </motion.div>
</template>

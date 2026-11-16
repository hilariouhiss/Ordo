<script setup lang="ts">
import { Check, Plus } from "@lucide/vue";
import { nextTick, ref, watch } from "vue";
import type { CaptureSubmission } from "../../lib/capture";
import { todayIso } from "../../lib/dates";
import { t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import type { CaptureFields } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { createCaptureDraftVM } from "../../viewmodels/captureDraftVM";
import CaptureChips from "./CaptureChips.vue";

const props = defineProps<{
  projectId?: string | null;
  /** The + is a button that opens the detailed form. */ add?: boolean;
}>();
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ submit: [submission: CaptureSubmission]; add: [] }>();

const draft = createCaptureDraftVM(
  () => ({ today: todayIso(), projects: appVM.state.projects, people: appVM.state.people }),
  () => (props.projectId ? { projectId: props.projectId } : {}),
);
const {
  title,
  fields,
  matched,
  expectedStart,
  finish,
  actualStart,
  actualFinish,
  newProjectName,
  done,
} = draft;

const input = ref<HTMLInputElement | null>(null);
let refreshedAt = 0;

watch(model, (raw) => draft.setRaw(raw), { immediate: true });

/** Pick up projects and people added since the app started. */
function refreshContext(): void {
  const now = Date.now();
  if (now - refreshedAt < 5000) return;
  refreshedAt = now;
  void appVM.load().catch(() => {});
}

function onEdit(patch: Partial<CaptureFields>): void {
  draft.edit(patch);
  void nextTick(() => input.value?.focus());
}

function submit(): void {
  if (!model.value.trim()) return;
  emit("submit", {
    raw: model.value,
    title: title.value,
    fields: { ...fields.value },
    newProjectName: newProjectName.value,
    done: done.value,
  });
}

function onSubmit(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  submit();
}

defineExpose({ submit, focus: () => input.value?.focus() });
</script>

<template>
  <div class="rounded-lg bg-base-100 px-3">
    <div class="flex min-h-12 items-center gap-2.5">
      <button
        v-if="props.add"
        type="button"
        class="grid size-[22px] shrink-0 place-items-center rounded-md text-base-content/55 hover:bg-base-300/70 hover:text-base-content"
        :aria-label="t('quickCreate.taskTitle')"
        :title="t('quickCreate.taskTitle')"
        @click="emit('add')"
      >
        <Plus :size="15" aria-hidden="true" />
      </button>
      <Plus v-else :size="15" class="shrink-0 text-base-content/55" aria-hidden="true" />
      <input
        ref="input"
        v-model="model"
        class="w-full bg-transparent text-[14px] outline-none placeholder:text-base-content/55"
        :placeholder="t('capture.placeholder')"
        :title="t('capture.syntax')"
        @focus="refreshContext"
        @keydown.enter="onSubmit"
      />
      <button
        type="button"
        role="switch"
        :aria-checked="done"
        class="inline-flex h-[26px] shrink-0 items-center gap-1 rounded-md border px-2 text-[12px] leading-none"
        :class="
          done
            ? 'border-success/40 bg-success/10 text-success'
            : 'border-base-300 bg-base-100 text-base-content/65 hover:border-base-content/30 hover:text-base-content'
        "
        @mousedown.prevent
        @click="draft.setDone(!done)"
      >
        <Check :size="12" aria-hidden="true" />
        {{ t("capture.done") }}
      </button>
      <span class="shrink-0 text-[11.5px] text-base-content/55">{{ t("capture.saveHint") }}</span>
    </div>
    <CaptureChips
      v-if="model.trim()"
      :fields="fields"
      :matched="matched"
      :expected-start="expectedStart"
      :finish="finish"
      :actual-start="actualStart"
      :actual-finish="actualFinish"
      :done="done"
      :new-project-name="newProjectName"
      @edit="onEdit"
    />
  </div>
</template>

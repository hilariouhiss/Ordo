<script setup lang="ts">
import { Check } from "@lucide/vue";
import { nextTick, ref, watch } from "vue";
import type { CaptureSubmission } from "../../lib/capture";
import { todayIso } from "../../lib/dates";
import { t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import type { CaptureFields } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { createCaptureDraftVM } from "../../viewmodels/captureDraftVM";
import CaptureChips from "./CaptureChips.vue";

const props = defineProps<{ projectId?: string | null }>();
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ submit: [submission: CaptureSubmission] }>();

const draft = createCaptureDraftVM(
  () => ({ today: todayIso(), projects: appVM.state.projects, people: appVM.state.people }),
  () => (props.projectId ? { projectId: props.projectId } : {}),
);
const { title, fields, matched, finish, newProjectName, done } = draft;

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
  <div class="rounded-xl bg-base-100 px-4 py-2.5">
    <div class="flex items-center gap-2">
      <input
        ref="input"
        v-model="model"
        class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/40"
        :placeholder="t('capture.placeholder')"
        :title="t('capture.syntax')"
        @focus="refreshContext"
        @keydown.enter="onSubmit"
      />
      <button
        type="button"
        role="switch"
        :aria-checked="done"
        class="inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-1.5 text-[10.5px] leading-none"
        :class="
          done
            ? 'border-success/40 bg-success/10 text-success'
            : 'border-base-300 bg-base-100 text-base-content/45 hover:text-base-content/70'
        "
        @mousedown.prevent
        @click="draft.setDone(!done)"
      >
        <Check :size="12" aria-hidden="true" />
        {{ t("capture.done") }}
      </button>
      <span class="shrink-0 text-[10.5px] text-base-content/35">{{ t("capture.saveHint") }}</span>
    </div>
    <CaptureChips
      v-if="model.trim()"
      :fields="fields"
      :matched="matched"
      :finish="finish"
      :done="done"
      :new-project-name="newProjectName"
      @edit="onEdit"
    />
  </div>
</template>

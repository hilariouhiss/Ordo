<script setup lang="ts">
import { X } from "@lucide/vue";
import { motion } from "motion-v";
import { ref } from "vue";
import { errorText, t } from "../../lib/i18n";
import { backdropMotion, modalPanelMotion } from "../../lib/motion";
import { requirementsVM, type PipelineEntry } from "../../viewmodels/requirementsVM";
import StatusFlowEditor from "../components/StatusFlowEditor.vue";

defineProps<{ projectId: string }>();
const emit = defineEmits<{ close: [] }>();

const rows = ref<PipelineEntry[]>(
  requirementsVM.state.statuses.map((status) => ({ id: status.id, name: status.name })),
);
const error = ref("");
const saving = ref(false);

async function save(): Promise<void> {
  if (rows.value.some((row) => !row.name.trim())) {
    error.value = "empty_status_name";
    return;
  }
  saving.value = true;
  error.value = "";
  const ok = await requirementsVM.saveStatuses(rows.value);
  saving.value = false;
  if (!ok) {
    error.value = requirementsVM.state.error ?? "common.actionFailed";
    return;
  }
  emit("close");
}
</script>

<template>
  <Teleport to="body">
    <motion.div
      v-bind="backdropMotion"
      class="window-scrim fixed inset-0 z-50 flex items-center justify-center bg-neutral/40 p-4"
      @click.self="emit('close')"
    >
      <motion.div
        v-bind="modalPanelMotion"
        class="w-full max-w-[460px] rounded-2xl bg-base-100 p-5 shadow-2xl"
      >
        <div class="flex items-center gap-2">
          <h2 class="text-[15px] font-semibold">{{ t("requirements.statusFlowTitle") }}</h2>
          <span class="text-[11px] text-base-content/50">{{
            t("requirements.statusFlowProject")
          }}</span>
          <button
            class="ml-auto text-base-content/30"
            :aria-label="t('common.close')"
            @click="emit('close')"
          >
            <X :size="15" aria-hidden="true" />
          </button>
        </div>
        <p class="mt-1 text-[11px] leading-5 text-base-content/50">
          {{ t("requirements.statusFlowHint") }}
        </p>
        <div class="mt-3">
          <StatusFlowEditor v-model="rows" />
        </div>
        <p class="mt-3 text-[11px] leading-5 text-base-content/50">
          {{ t("requirements.statusDeleteHint") }}
        </p>
        <p v-if="error" class="mt-2 text-[12px] text-error">{{ errorText(error) }}</p>
        <div class="mt-4 flex justify-end gap-2">
          <button
            class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
            @click="emit('close')"
          >
            {{ t("common.cancel") }}
          </button>
          <button
            class="btn btn-sm rounded-lg border-0 bg-base-content text-base-100"
            :disabled="saving"
            @click="save"
          >
            {{ t("common.save") }}
          </button>
        </div>
      </motion.div>
    </motion.div>
  </Teleport>
</template>

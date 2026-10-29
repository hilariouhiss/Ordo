<script setup lang="ts">
import { X } from "@lucide/vue";
import { motion } from "motion-v";
import { reactive, ref } from "vue";
import { errorText, t } from "../../lib/i18n";
import { backdropMotion, modalPanelMotion } from "../../lib/motion";
import { weekdayName } from "../../lib/rules";
import type { RuleInput, TaskAttrs, TaskRule } from "../../model/types";
import { templatesVM } from "../../viewmodels/templatesVM";
import TaskAttrFields from "../components/TaskAttrFields.vue";
import TimeField from "../components/TimeField.vue";

const props = defineProps<{ rule: TaskRule | null }>();
const emit = defineEmits<{ close: [] }>();

const DAYS = [1, 2, 3, 4, 5, 6, 7];

/** The rule starts on today so a new one usually shows something right away. */
function todayWeekday(): number {
  const day = new Date().getDay();
  return day === 0 ? 7 : day;
}

const form = reactive({
  title: props.rule?.title ?? "",
  weekdays: [...(props.rule?.weekdays ?? [todayWeekday()])],
  at: props.rule?.at ?? "09:00",
});
const attrs = ref<TaskAttrs>({
  projectId: props.rule?.projectId ?? null,
  categoryId: props.rule?.categoryId ?? null,
  ownerId: props.rule?.ownerId ?? null,
  priority: props.rule?.priority ?? "normal",
  effortMinutes: props.rule?.effortMinutes ?? 480,
  exclusive: props.rule?.exclusive ?? true,
});
const error = ref("");
const saving = ref(false);

function toggleDay(day: number): void {
  const index = form.weekdays.indexOf(day);
  if (index >= 0) form.weekdays.splice(index, 1);
  else form.weekdays.push(day);
}

async function save(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  error.value = "";
  try {
    const draft: RuleInput = {
      id: props.rule?.id ?? null,
      title: form.title,
      weekdays: form.weekdays,
      at: form.at,
      ...attrs.value,
    };
    await templatesVM.saveRule(draft);
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
    class="window-scrim fixed inset-0 z-[80] flex items-center justify-center bg-neutral/40 p-4"
    @click.self="emit('close')"
    @keydown.esc="emit('close')"
  >
    <motion.div
      v-bind="modalPanelMotion"
      role="dialog"
      aria-modal="true"
      :aria-label="t(rule ? 'rule.editTitle' : 'rule.newTitle')"
      class="max-h-[86vh] w-full max-w-[460px] overflow-y-auto rounded-2xl bg-base-100 p-4 shadow-2xl"
    >
      <div class="flex items-center">
        <h2 class="text-[14px] font-semibold">
          {{ t(rule ? "rule.editTitle" : "rule.newTitle") }}
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
        v-model="form.title"
        class="input input-sm mt-3 w-full rounded-lg border-base-300 text-[12.5px]"
        :placeholder="t('rule.titlePlaceholder')"
        :aria-label="t('rule.name')"
        autofocus
      />

      <div class="mt-3 text-[10.5px] font-medium tracking-wide text-base-content/40">
        {{ t("rule.weekdays") }}
      </div>
      <div class="mt-1.5 flex flex-wrap items-center gap-1">
        <button
          v-for="day in DAYS"
          :key="day"
          type="button"
          class="btn btn-xs rounded-md border-base-300 font-normal"
          :class="
            form.weekdays.includes(day) ? 'border-0 bg-primary text-primary-content' : 'bg-base-100'
          "
          @click="toggleDay(day)"
        >
          {{ weekdayName(day) }}
        </button>
        <label class="ml-1 flex items-center gap-1.5 text-[11px] text-base-content/45">
          {{ t("rule.time") }}
          <TimeField v-model="form.at" class="input input-sm w-28 rounded-lg border-base-300" />
        </label>
      </div>

      <TaskAttrFields v-model="attrs" />

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
          :disabled="saving || !form.title.trim() || !form.weekdays.length"
          @click="save"
        >
          {{ t("common.save") }}
        </button>
      </div>
    </motion.div>
  </motion.div>
</template>

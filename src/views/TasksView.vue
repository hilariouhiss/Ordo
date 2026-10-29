<script setup lang="ts">
import { AnimatePresence } from "motion-v";
import { computed, onMounted, watch } from "vue";
import { t } from "../lib/i18n";
import type { Task } from "../model/types";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { tasksVM } from "../viewmodels/tasksVM";
import TaskRow from "./components/TaskRow.vue";
import TaskSheet from "./overlays/TaskSheet.vue";

const groupOptions = computed(
  () =>
    [
      { value: "none", label: t("tasks.groupNone") },
      { value: "project", label: t("tasks.groupProject") },
      { value: "category", label: t("tasks.groupCategory") },
      { value: "tag", label: t("tasks.groupTag") },
    ] as const,
);
// A ref nested in the VM object is not unwrapped by the template.
const sections = computed(() => tasksVM.sections.value);

onMounted(() => void tasksVM.load());

watch(
  () => taskSheetVM.state.openId,
  (open) => {
    if (!open) void tasksVM.load();
  },
);

function openTask(task: Task): void {
  void taskSheetVM.open(task.id);
}

function refresh(): void {
  void tasksVM.load();
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">{{ t("tasks.title") }}</h1>
      <span class="text-[11px] tabular-nums text-base-content/45">
        {{ t("tasks.count", { count: tasksVM.state.tasks.length }) }}
      </span>
      <span class="ml-auto text-[10.5px] text-base-content/35">{{
        tasksVM.state.groupBy === "tag" ? t("tasks.tagHint") : t("tasks.hint")
      }}</span>
    </div>

    <div role="tablist" :aria-label="t('tasks.groupByAria')" class="tabs tabs-border tabs-sm">
      <button
        v-for="option in groupOptions"
        :key="option.value"
        role="tab"
        class="tab"
        :class="{ 'tab-active': tasksVM.state.groupBy === option.value }"
        :aria-selected="tasksVM.state.groupBy === option.value"
        @click="tasksVM.setGroupBy(option.value)"
      >
        {{ option.label }}
      </button>
    </div>

    <div v-if="tasksVM.state.tasks.length" class="space-y-2">
      <section v-for="group in sections" :key="group.key">
        <div
          v-if="tasksVM.state.groupBy !== 'none'"
          class="flex items-center gap-2 px-1 pt-2 pb-1 text-[10.5px] text-base-content/45"
        >
          <h2 class="font-medium text-base-content/60">{{ group.name }}</h2>
          <span class="tabular-nums">{{ group.tasks.length }}</span>
          <span class="h-px flex-1 bg-base-300/70"></span>
        </div>
        <AnimatePresence as="ul" mode="popLayout" :initial="false" class="space-y-1.5">
          <TaskRow
            v-for="task in group.tasks"
            :key="task.id"
            :task="task"
            :show-project="tasksVM.state.groupBy !== 'project'"
            @open="openTask"
            @changed="refresh"
          />
        </AnimatePresence>
      </section>
    </div>
    <p v-else-if="!tasksVM.state.loading" class="px-1 text-[13px] text-base-content/40">
      {{ t("tasks.empty") }}
    </p>

    <AnimatePresence>
      <TaskSheet v-if="taskSheetVM.state.openId" />
    </AnimatePresence>
  </section>
</template>

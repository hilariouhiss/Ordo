<script setup lang="ts">
import { AnimatePresence } from "motion-v";
import { onMounted, watch } from "vue";
import { t } from "../lib/i18n";
import type { Task } from "../model/types";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { tasksVM } from "../viewmodels/tasksVM";
import TaskRow from "./components/TaskRow.vue";
import TaskSheet from "./overlays/TaskSheet.vue";

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
      <span class="ml-auto text-[10.5px] text-base-content/35">{{ t("tasks.hint") }}</span>
    </div>

    <AnimatePresence
      v-if="tasksVM.state.tasks.length"
      as="ul"
      mode="popLayout"
      :initial="false"
      class="space-y-1.5"
    >
      <TaskRow
        v-for="task in tasksVM.state.tasks"
        :key="task.id"
        :task="task"
        @open="openTask"
        @changed="refresh"
      />
    </AnimatePresence>
    <p v-else-if="!tasksVM.state.loading" class="px-1 text-[13px] text-base-content/40">
      {{ t("tasks.empty") }}
    </p>

    <AnimatePresence>
      <TaskSheet v-if="taskSheetVM.state.openId" />
    </AnimatePresence>
  </section>
</template>

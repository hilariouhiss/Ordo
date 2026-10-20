<script setup lang="ts">
import { onMounted, watch } from "vue";
import type { Task } from "../model/types";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { weekVM } from "../viewmodels/weekVM";
import CaptureBar from "./components/CaptureBar.vue";
import TaskRow from "./components/TaskRow.vue";
import TaskSheet from "./overlays/TaskSheet.vue";

onMounted(() => {
  void weekVM.load();
});

watch(
  () => taskSheetVM.state.openId,
  (open) => {
    if (!open) void weekVM.load();
  },
);

function openTask(task: Task): void {
  void taskSheetVM.open(task.id);
}
</script>

<template>
  <section class="space-y-2">
    <CaptureBar v-model="weekVM.state.draft" @submit="weekVM.capture" />

    <ul v-if="weekVM.state.tasks.length" class="space-y-1.5">
      <TaskRow v-for="task in weekVM.state.tasks" :key="task.id" :task="task" @open="openTask" />
    </ul>

    <p v-else-if="!weekVM.state.loading" class="px-1 text-[13px] text-base-content/40">
      这周还是空的。在上面记一句。
    </p>

    <TaskSheet v-if="taskSheetVM.state.openId" />
  </section>
</template>

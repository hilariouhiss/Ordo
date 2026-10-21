<script setup lang="ts">
import { onMounted, watch } from "vue";
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
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">任务</h1>
      <span class="text-[11px] tabular-nums text-base-content/45">
        共 {{ tasksVM.state.tasks.length }} 条
      </span>
      <span class="ml-auto text-[10.5px] text-base-content/35">不在本周的也在这里</span>
    </div>

    <ul v-if="tasksVM.state.tasks.length" class="space-y-1.5">
      <TaskRow v-for="task in tasksVM.state.tasks" :key="task.id" :task="task" @open="openTask" />
    </ul>
    <p v-else-if="!tasksVM.state.loading" class="px-1 text-[13px] text-base-content/40">
      还没有任务。
    </p>

    <TaskSheet v-if="taskSheetVM.state.openId" />
  </section>
</template>

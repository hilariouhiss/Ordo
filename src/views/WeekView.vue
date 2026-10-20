<script setup lang="ts">
import { computed, onMounted, watch } from "vue";
import { shortDate } from "../lib/dates";
import type { Task } from "../model/types";
import { appVM } from "../viewmodels/appVM";
import { passVM } from "../viewmodels/passVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { weekVM } from "../viewmodels/weekVM";
import CaptureBar from "./components/CaptureBar.vue";
import TaskRow from "./components/TaskRow.vue";
import TaskSheet from "./overlays/TaskSheet.vue";
import WeeklyPass from "./overlays/WeeklyPass.vue";

const suspendedOpen = computed(() => weekVM.state.suspended.length > 0);

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
    <div
      v-if="appVM.state.passNeeded"
      class="flex items-center gap-3 rounded-xl bg-base-100 px-4 py-2.5"
    >
      <span class="text-[12.5px]">这一周的事还没结清</span>
      <span class="text-[11px] text-base-content/45">{{ weekVM.state.tasks.length }} 件待定</span>
      <button
        class="btn btn-sm ml-auto rounded-lg border-0 bg-primary text-primary-content"
        @click="passVM.start"
      >
        过一遍
      </button>
    </div>

    <CaptureBar v-model="weekVM.state.draft" @submit="weekVM.capture" />

    <ul v-if="weekVM.state.tasks.length" class="space-y-1.5">
      <TaskRow v-for="task in weekVM.state.tasks" :key="task.id" :task="task" @open="openTask" />
    </ul>

    <p v-else-if="!weekVM.state.loading" class="px-1 text-[13px] text-base-content/40">
      这周还是空的。在上面记一句。
    </p>

    <div v-if="suspendedOpen" class="rounded-xl bg-base-100 px-3 py-2.5">
      <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">
        挂起 ({{ weekVM.state.suspended.length }})
      </div>
      <div
        v-for="task in weekVM.state.suspended"
        :key="task.id"
        class="mt-1.5 flex items-center gap-2 text-[12px]"
      >
        <span>{{ task.title }}</span>
        <span class="text-[10.5px] text-base-content/40">
          {{ shortDate(task.suspendedUntil) }} 再看
        </span>
        <button class="ml-auto text-[10.5px] text-primary" @click="weekVM.resume(task.id)">
          捞回本周
        </button>
      </div>
    </div>

    <div class="flex items-center gap-3 px-1 text-[11px] text-base-content/45">
      <span class="tabular-nums">
        本周完成 {{ weekVM.state.stats.done }} · 新增 {{ weekVM.state.stats.added }} · 延期
        {{ weekVM.state.stats.delayed }}
      </span>
    </div>

    <TaskSheet v-if="taskSheetVM.state.openId" />
    <WeeklyPass v-if="passVM.state.open" />
  </section>
</template>

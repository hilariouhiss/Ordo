<script setup lang="ts">
import { Ellipsis } from "@lucide/vue";
import { computed, onMounted, ref, watch } from "vue";
import { shortDate, todayIso } from "../lib/dates";
import type { Task } from "../model/types";
import { createProjectVM } from "../viewmodels/projectVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import CaptureBar from "./components/CaptureBar.vue";
import CategoryProgress from "./components/CategoryProgress.vue";
import SummaryLine from "./components/SummaryLine.vue";
import TaskRow from "./components/TaskRow.vue";
import TimelineView from "./components/TimelineView.vue";
import ProjectSettings from "./overlays/ProjectSettings.vue";
import TaskSheet from "./overlays/TaskSheet.vue";

const props = defineProps<{ id: string }>();
const vm = createProjectVM();
const settingsOpen = ref(false);

onMounted(() => {
  void vm.load(props.id);
});

watch(
  () => taskSheetVM.state.openId,
  (open) => {
    if (!open) void vm.load(props.id);
  },
);

const daysLeft = computed(() => {
  const due = vm.state.summary?.dueDate;
  if (!due) return null;
  return Math.ceil((Date.parse(due) - Date.parse(todayIso())) / 86_400_000);
});

const progressPct = computed(() => {
  const s = vm.state.summary;
  return s && s.total ? Math.round((s.done / s.total) * 100) : 0;
});

const tasksByCategory = computed(() => {
  const map = new Map<string, Task[]>();
  for (const task of vm.state.tasks) {
    const key = task.categoryId ?? "";
    const list = map.get(key) ?? [];
    list.push(task);
    map.set(key, list);
  }
  return map;
});

function openTask(task: Task): void {
  void taskSheetVM.open(task.id);
}
</script>

<template>
  <section v-if="vm.state.summary" class="space-y-2">
    <div class="flex items-start gap-3">
      <div>
        <div class="text-[16px] font-semibold tracking-tight">{{ vm.state.summary.name }}</div>
        <div class="mt-0.5 flex items-center gap-2 text-[11.5px] text-base-content/50">
          <span v-if="vm.state.summary.dueDate" class="badge badge-ghost badge-xs">
            截止 {{ shortDate(vm.state.summary.dueDate) }}
          </span>
          <span v-if="daysLeft !== null">剩 {{ daysLeft }} 天</span>
        </div>
      </div>
      <div class="ml-auto flex items-center gap-2">
        <div role="tablist" class="tabs tabs-border tabs-xs">
          <button
            role="tab"
            class="tab"
            :class="{ 'tab-active': vm.state.view === 'group' }"
            @click="vm.state.view = 'group'"
          >
            分组
          </button>
          <button
            role="tab"
            class="tab"
            :class="{ 'tab-active': vm.state.view === 'timeline' }"
            @click="vm.state.view = 'timeline'"
          >
            时间轴
          </button>
        </div>
        <button class="text-base-content/35" aria-label="项目设置" @click="settingsOpen = true">
          <Ellipsis :size="15" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="flex items-center gap-3 px-1">
      <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-base-300">
        <span
          class="block h-full rounded-full bg-primary"
          :style="{ width: progressPct + '%' }"
        ></span>
      </span>
      <span class="text-[11.5px] tabular-nums text-base-content/55">
        {{ vm.state.summary.done }}/{{ vm.state.summary.total }}
      </span>
    </div>

    <CaptureBar v-model="vm.state.draft" @submit="vm.captureInto(props.id)" />

    <template v-if="vm.state.view === 'group'">
      <CategoryProgress
        v-for="category in vm.state.summary.byCategory"
        :key="category.categoryId"
        :category="category"
        :expanded="!!vm.state.expanded[category.categoryId]"
        @toggle="vm.toggle(category.categoryId)"
      >
        <ul class="mt-1.5 space-y-1">
          <TaskRow
            v-for="task in tasksByCategory.get(category.categoryId) ?? []"
            :key="task.id"
            :task="task"
            @open="openTask"
          />
        </ul>
      </CategoryProgress>

      <div v-if="(tasksByCategory.get('') ?? []).length" class="rounded-xl bg-base-100 px-3 py-2.5">
        <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">未分类</div>
        <ul class="mt-1.5 space-y-1">
          <TaskRow
            v-for="task in tasksByCategory.get('') ?? []"
            :key="task.id"
            :task="task"
            @open="openTask"
          />
        </ul>
      </div>
    </template>

    <TimelineView v-else :tasks="vm.state.tasks" />

    <SummaryLine
      :text="vm.state.summary.summaryLine"
      :copied="vm.state.copied"
      @copy="vm.copySummary"
    />

    <TaskSheet v-if="taskSheetVM.state.openId" />
    <ProjectSettings
      v-if="settingsOpen"
      :id="props.id"
      @close="
        settingsOpen = false;
        vm.load(props.id);
      "
    />
  </section>
</template>

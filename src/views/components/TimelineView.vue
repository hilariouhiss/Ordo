<script setup lang="ts">
import { computed } from "vue";
import { addDays, shortDate, todayIso } from "../../lib/dates";
import { timelineLayout } from "../../lib/timeline";
import type { Task } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";

const props = defineProps<{ tasks: Task[] }>();

const today = computed(() => todayIso());
const range = computed(() => ({
  start: addDays(today.value, -21),
  end: addDays(today.value, 21),
}));

const layout = computed(() => {
  const rows = timelineLayout(
    range.value,
    props.tasks.map((task) => ({
      id: task.id,
      title: task.title,
      startDate: task.startDate,
      dueDate: task.dueDate,
      categoryId: task.categoryId,
      status: task.status,
    })),
  );
  return new Map(rows.map((row) => [row.taskId, row]));
});

const ticks = computed(() =>
  Array.from({ length: 7 }, (_, i) => addDays(range.value.start, i * 7)),
);

const todayPct = computed(() => {
  const days = Math.round((Date.parse(today.value) - Date.parse(range.value.start)) / 86_400_000);
  return (days / 42) * 100;
});

const groups = computed(() => {
  const map = new Map<string, Task[]>();
  for (const task of props.tasks) {
    const key = task.categoryId ?? "";
    const list = map.get(key) ?? [];
    list.push(task);
    map.set(key, list);
  }
  return [...map.entries()].map(([categoryId, tasks]) => ({
    name: appVM.state.categories.find((c) => c.id === categoryId)?.name ?? "未分类",
    tasks,
  }));
});
</script>

<template>
  <div class="rounded-xl bg-base-100 p-3">
    <div class="relative ml-[110px] h-5 border-b border-base-200 text-[10px] text-base-content/40">
      <span
        v-for="(tick, i) in ticks"
        :key="tick"
        class="absolute -translate-x-1/2"
        :style="{ left: (i / 6) * 100 + '%' }"
      >
        {{ shortDate(tick) }}
      </span>
    </div>

    <div class="relative mt-1">
      <div
        class="absolute inset-y-0 z-10 w-px bg-error/60"
        :style="{ left: `calc(110px + ${todayPct}%)` }"
      ></div>
      <div
        class="absolute -top-0.5 z-10 -translate-x-1/2 rounded-sm bg-error px-1 text-[9px] leading-3 text-error-content"
        :style="{ left: `calc(110px + ${todayPct}%)` }"
      >
        今天
      </div>

      <div v-for="group in groups" :key="group.name" class="mt-2">
        <div class="text-[10px] font-medium text-base-content/40">{{ group.name }}</div>
        <div
          v-for="task in group.tasks"
          :key="task.id"
          class="flex items-center py-0.5 text-[11.5px]"
        >
          <span class="w-[110px] shrink-0 truncate pr-2">{{ task.title }}</span>
          <div class="relative h-3 flex-1">
            <div
              v-if="layout.get(task.id)"
              class="absolute top-[3px] h-2 rounded-full bg-primary/45"
              :class="{
                'border-l-2 border-dashed border-primary/70': layout.get(task.id)?.dashedStart,
                'border-r-2 border-dashed border-primary/70': layout.get(task.id)?.dashedEnd,
              }"
              :style="{
                left: layout.get(task.id)?.leftPct + '%',
                width: layout.get(task.id)?.widthPct + '%',
              }"
            ></div>
          </div>
        </div>
      </div>
    </div>

    <div class="mt-2 flex items-center gap-4 text-[10.5px] text-base-content/40">
      <span>实线＝有计划</span><span>虚线＝缺一端日期</span
      ><span class="text-error">红线＝今天</span>
      <span class="ml-auto">只画时间，不画依赖</span>
    </div>
  </div>
</template>

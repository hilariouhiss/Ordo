<script setup lang="ts">
import { computed } from "vue";
import { shortDate, todayIso } from "../../lib/dates";
import { overdueDays } from "../../model/mappers";
import type { Task } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import StatusDot from "./StatusDot.vue";

const props = defineProps<{ task: Task }>();
const emit = defineEmits<{ open: [Task] }>();

const category = computed(
  () => appVM.state.categories.find((c) => c.id === props.task.categoryId)?.name ?? null,
);
const owner = computed(
  () => appVM.state.people.find((p) => p.id === props.task.ownerId)?.name ?? null,
);
const stepsDone = computed(() => props.task.steps.filter((s) => s.done).length);
const late = computed(() => overdueDays(props.task.dueDate, todayIso()));
const overdue = computed(() => late.value > 0 && props.task.status !== "done");
</script>

<template>
  <li
    class="flex cursor-pointer items-center gap-2.5 rounded-xl bg-base-100 px-3 py-3 transition-opacity hover:opacity-90"
    @click="emit('open', task)"
  >
    <StatusDot :status="task.status" />
    <span
      class="text-[13px]"
      :class="{ 'text-base-content/40 line-through': task.status === 'done' }"
    >
      {{ task.title }}
    </span>
    <span v-if="category" class="badge badge-ghost badge-xs">{{ category }}</span>
    <span v-if="task.steps.length" class="text-[10px] text-base-content/40">
      {{ stepsDone }}/{{ task.steps.length }}
    </span>
    <span v-if="task.carryCount" class="badge badge-soft badge-warning badge-xs">
      第 {{ task.carryCount }} 次
    </span>
    <span v-if="overdue" class="badge badge-soft badge-error badge-xs">逾期 {{ late }} 天</span>
    <span class="ml-auto text-[11px] text-base-content/45">{{ owner }}</span>
    <span
      v-if="task.dueDate"
      class="w-11 text-right text-[11px]"
      :class="overdue ? 'text-error' : 'text-base-content/45'"
    >
      {{ shortDate(task.dueDate) }}
    </span>
  </li>
</template>

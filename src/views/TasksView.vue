<script setup lang="ts">
import { ChevronRight, GripVertical } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, ref, watch } from "vue";
import { t } from "../lib/i18n";
import { panelSwapMotion } from "../lib/motion";
import { NONE_GROUP_KEY, type TaskGroup } from "../lib/taskGroups";
import type { Task } from "../model/types";
import { appVM } from "../viewmodels/appVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { tasksVM } from "../viewmodels/tasksVM";
import TaskRow from "./components/TaskRow.vue";
import TaskSheet from "./overlays/TaskSheet.vue";

const groupOptions = computed(
  () =>
    [
      { value: "project", label: t("tasks.groupProject") },
      { value: "none", label: t("tasks.groupNone") },
      { value: "category", label: t("tasks.groupCategory") },
      { value: "tag", label: t("tasks.groupTag") },
      { value: "owner", label: t("tasks.groupOwner") },
      { value: "priority", label: t("tasks.groupPriority") },
    ] as const,
);
// A ref nested in the VM object is not unwrapped by the template.
const sections = computed(() => tasksVM.sections.value);
const draggingTaskId = ref<string | null>(null);
const dragOverGroup = ref<string | null>(null);
let dragEndedAt = 0;

const hint = computed(() => {
  if (tasksVM.state.groupBy === "project") return t("tasks.dragProjectHint");
  if (tasksVM.state.groupBy === "tag") return t("tasks.tagHint");
  return t("tasks.hint");
});

onMounted(() => void tasksVM.load());

watch(
  () => taskSheetVM.state.openId,
  (open) => {
    if (!open) void tasksVM.load();
  },
);

function openTask(task: Task): void {
  // Native drag usually suppresses click; WebView2 can still emit one right after.
  if (Date.now() - dragEndedAt < 200) return;
  void taskSheetVM.open(task.id);
}

function refresh(): void {
  void tasksVM.load();
}

function groupListId(key: string): string {
  return `tasks-group-${key}`;
}

function projectIdForGroup(group: TaskGroup): string | null | undefined {
  if (group.key === NONE_GROUP_KEY) return null;
  return appVM.state.projects.some((project) => project.id === group.key) ? group.key : undefined;
}

function onTaskDragStart(event: DragEvent, task: Task): void {
  if (tasksVM.state.groupBy !== "project") return;
  draggingTaskId.value = task.id;
  dragOverGroup.value = null;
  event.dataTransfer?.setData("text/plain", task.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onTaskDragEnd(): void {
  dragEndedAt = Date.now();
  draggingTaskId.value = null;
  dragOverGroup.value = null;
}

function onGroupDragOver(event: DragEvent, group: TaskGroup): void {
  if (!draggingTaskId.value || projectIdForGroup(group) === undefined) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dragOverGroup.value = group.key;
}

function onGroupDragLeave(event: DragEvent, group: TaskGroup): void {
  if (dragOverGroup.value !== group.key) return;
  const section = event.currentTarget as HTMLElement | null;
  const under = document.elementFromPoint(event.clientX, event.clientY);
  if (section && under && section.contains(under)) return;
  dragOverGroup.value = null;
}

async function onGroupDrop(event: DragEvent, group: TaskGroup): Promise<void> {
  const projectId = projectIdForGroup(group);
  if (projectId === undefined) return;
  event.preventDefault();
  const taskId = draggingTaskId.value ?? event.dataTransfer?.getData("text/plain") ?? null;
  const groupKey = group.key;
  onTaskDragEnd();
  if (!taskId) return;
  const moved = await tasksVM.assignProject(taskId, projectId);
  if (moved && tasksVM.isGroupCollapsed(groupKey)) tasksVM.toggleGroup(groupKey);
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">{{ t("tasks.title") }}</h1>
      <span class="text-[11px] tabular-nums text-base-content/45">
        {{ t("tasks.count", { count: tasksVM.state.tasks.length }) }}
      </span>
      <span class="ml-auto text-[10.5px] text-base-content/35">{{ hint }}</span>
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

    <AnimatePresence mode="wait" :initial="false">
      <motion.div :key="tasksVM.state.groupBy" v-bind="panelSwapMotion">
        <div v-if="tasksVM.state.tasks.length" class="space-y-2">
          <section
            v-for="group in sections"
            :key="group.key"
            :class="
              tasksVM.state.groupBy === 'project' && dragOverGroup === group.key
                ? 'rounded-xl bg-primary/5 ring-2 ring-primary/30'
                : ''
            "
            @dragover="onGroupDragOver($event, group)"
            @dragleave="onGroupDragLeave($event, group)"
            @drop="onGroupDrop($event, group)"
          >
            <h2 v-if="tasksVM.state.groupBy !== 'none'">
              <button
                type="button"
                class="flex w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-1 pt-2 pb-1 text-left text-[10.5px] text-base-content/45 hover:text-base-content/70 focus-visible:ring-2 focus-visible:ring-primary/40"
                :aria-expanded="!tasksVM.isGroupCollapsed(group.key)"
                :aria-controls="groupListId(group.key)"
                :aria-label="
                  t(
                    tasksVM.isGroupCollapsed(group.key)
                      ? 'tasks.expandGroup'
                      : 'tasks.collapseGroup',
                    {
                      name: group.name,
                    },
                  )
                "
                @click="tasksVM.toggleGroup(group.key)"
              >
                <ChevronRight
                  :size="12"
                  aria-hidden="true"
                  class="shrink-0 transition-transform duration-150"
                  :class="{ 'rotate-90': !tasksVM.isGroupCollapsed(group.key) }"
                />
                <span class="font-medium text-base-content/60">{{ group.name }}</span>
                <span class="tabular-nums">{{ group.tasks.length }}</span>
                <span class="h-px flex-1 bg-base-300/70"></span>
              </button>
            </h2>
            <div :id="groupListId(group.key)">
              <AnimatePresence
                v-if="tasksVM.state.groupBy === 'none' || !tasksVM.isGroupCollapsed(group.key)"
                as="ul"
                mode="popLayout"
                :initial="false"
                class="space-y-1.5"
              >
                <TaskRow
                  v-for="task in group.tasks"
                  :key="task.id"
                  :task="task"
                  :show-project="tasksVM.state.groupBy !== 'project'"
                  :draggable="tasksVM.state.groupBy === 'project'"
                  :style="{ opacity: draggingTaskId === task.id ? 0.4 : undefined }"
                  @open="openTask"
                  @changed="refresh"
                  @drag-start="onTaskDragStart"
                  @drag-end="onTaskDragEnd"
                >
                  <template #leading>
                    <span
                      v-if="tasksVM.state.groupBy === 'project'"
                      class="mt-0.5 shrink-0 cursor-grab text-base-content/25 active:cursor-grabbing"
                      :title="t('tasks.dragProjectHint')"
                      aria-hidden="true"
                      @click.stop
                    >
                      <GripVertical :size="14" />
                    </span>
                  </template>
                </TaskRow>
              </AnimatePresence>
            </div>
          </section>
        </div>
        <p v-else-if="!tasksVM.state.loading" class="px-1 text-[13px] text-base-content/40">
          {{ t("tasks.empty") }}
        </p>
      </motion.div>
    </AnimatePresence>

    <AnimatePresence>
      <TaskSheet v-if="taskSheetVM.state.openId" />
    </AnimatePresence>
  </section>
</template>

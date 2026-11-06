<script setup lang="ts">
import { ChevronRight, GripVertical, Plus, Search, X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, ref, watch } from "vue";
import { askText } from "../lib/dialog";
import { t } from "../lib/i18n";
import { panelSwapMotion } from "../lib/motion";
import { NONE_GROUP_KEY, type TaskGroup } from "../lib/taskGroups";
import type { Priority, Task } from "../model/types";
import { appVM } from "../viewmodels/appVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { tasksVM } from "../viewmodels/tasksVM";
import { undoVM } from "../viewmodels/undoVM";
import ChipSelect from "./components/ChipSelect.vue";
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
const savedViews = computed(() => tasksVM.savedViews.value);
const activeViewId = computed(() => tasksVM.activeViewId.value);
const filtering = computed(() => !tasksVM.isEmpty.value);
const shownCount = computed(() => tasksVM.filteredTasks.value.length);
type Facet = "projectId" | "categoryId" | "ownerId" | "tagId";

/** A saved filter can point at a value that is gone; show the id with a label. */
function withFallback(
  options: { value: string; label: string }[],
  value: string | null,
  label: string,
): { value: string; label: string }[] {
  if (!value || options.some((option) => option.value === value)) return options;
  return [...options, { value, label }];
}

const projectOptions = computed(() =>
  withFallback(
    [
      { value: "", label: t("filters.all") },
      ...appVM.state.projects.map((project) => ({ value: project.id, label: project.name })),
    ],
    tasksVM.state.filter.projectId,
    t("filters.removedOption"),
  ),
);
const categoryOptions = computed(() =>
  withFallback(
    [
      { value: "", label: t("filters.all") },
      ...[...appVM.state.categories]
        .sort((one, other) => one.sortOrder - other.sortOrder)
        .map((category) => ({ value: category.id, label: category.name })),
    ],
    tasksVM.state.filter.categoryId,
    t("filters.removedOption"),
  ),
);
const ownerOptions = computed(() =>
  withFallback(
    [
      { value: "", label: t("filters.all") },
      ...appVM.state.people.map((person) => ({ value: person.id, label: person.name })),
    ],
    tasksVM.state.filter.ownerId,
    t("filters.removedOption"),
  ),
);
const tagOptions = computed(() =>
  withFallback(
    [
      { value: "", label: t("filters.all") },
      ...appVM.state.tags.map((tag) => ({ value: tag.id, label: tag.name })),
    ],
    tasksVM.state.filter.tagId,
    t("filters.removedOption"),
  ),
);
const priorityOptions = computed(() => [
  { value: "", label: t("filters.all") },
  { value: "high", label: t("task.priorityHigh") },
  { value: "normal", label: t("task.priorityNormal") },
  { value: "low", label: t("task.priorityLow") },
]);

function setFacet(key: Facet, value: string): void {
  tasksVM.state.filter[key] = value || null;
}

function setPriority(value: string): void {
  tasksVM.state.filter.priority = (value || null) as Priority | null;
}

async function saveView(): Promise<void> {
  const name = await askText(t("filters.saveTitle"), "");
  if (name) await tasksVM.saveView(name);
}

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
// The same reload the week, archive and project pages do, so undo is visible here too.
watch(
  () => undoVM.state.revision,
  () => {
    void tasksVM.load();
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
  if (tasksVM.state.groupBy !== "project" || filtering.value) return;
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
  if (filtering.value || !draggingTaskId.value || projectIdForGroup(group) === undefined) return;
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
        {{
          filtering
            ? t("filters.count", { shown: shownCount, total: tasksVM.state.tasks.length })
            : t("tasks.count", { count: tasksVM.state.tasks.length })
        }}
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

    <div class="flex flex-wrap items-center gap-2">
      <div class="input input-sm flex w-56 items-center gap-1.5 rounded-lg border-0 bg-base-100">
        <Search :size="13" class="shrink-0 text-base-content/35" aria-hidden="true" />
        <input
          v-model="tasksVM.state.filter.query"
          class="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-base-content/35"
          :placeholder="t('filters.searchPlaceholder')"
          :aria-label="t('filters.searchPlaceholder')"
        />
        <button
          v-if="tasksVM.state.filter.query"
          type="button"
          class="shrink-0 text-base-content/35 hover:text-base-content"
          :aria-label="t('filters.clearQuery')"
          @click="tasksVM.state.filter.query = ''"
        >
          <X :size="12" aria-hidden="true" />
        </button>
      </div>
      <ChipSelect
        :model-value="tasksVM.state.filter.projectId ?? ''"
        :options="projectOptions"
        :label="t('filters.project')"
        class="select-xs rounded-lg border border-base-300 bg-base-100 text-[11px]"
        @update:model-value="setFacet('projectId', $event)"
      />
      <ChipSelect
        :model-value="tasksVM.state.filter.categoryId ?? ''"
        :options="categoryOptions"
        :label="t('filters.category')"
        class="select-xs rounded-lg border border-base-300 bg-base-100 text-[11px]"
        @update:model-value="setFacet('categoryId', $event)"
      />
      <ChipSelect
        :model-value="tasksVM.state.filter.ownerId ?? ''"
        :options="ownerOptions"
        :label="t('filters.owner')"
        class="select-xs rounded-lg border border-base-300 bg-base-100 text-[11px]"
        @update:model-value="setFacet('ownerId', $event)"
      />
      <ChipSelect
        :model-value="tasksVM.state.filter.tagId ?? ''"
        :options="tagOptions"
        :label="t('filters.tag')"
        class="select-xs rounded-lg border border-base-300 bg-base-100 text-[11px]"
        @update:model-value="setFacet('tagId', $event)"
      />
      <ChipSelect
        :model-value="tasksVM.state.filter.priority ?? ''"
        :options="priorityOptions"
        :label="t('filters.priority')"
        class="select-xs rounded-lg border border-base-300 bg-base-100 text-[11px]"
        @update:model-value="setPriority($event)"
      />
      <button
        v-if="filtering"
        type="button"
        class="px-1 text-[11px] text-base-content/40 hover:text-error"
        @click="tasksVM.clearFilter()"
      >
        {{ t("filters.clear") }}
      </button>
    </div>

    <div v-if="savedViews.length || filtering" class="flex flex-wrap items-center gap-1.5">
      <span class="text-[10.5px] text-base-content/40">{{ t("filters.savedViews") }}</span>
      <div
        v-for="view in savedViews"
        :key="view.id"
        class="flex items-center rounded-full border pr-1 pl-2.5 text-[11px]"
        :class="
          activeViewId === view.id
            ? 'border-primary/30 bg-primary/10 text-primary'
            : 'border-base-300 bg-base-100 text-base-content/60'
        "
      >
        <button type="button" class="py-1" @click="tasksVM.applyView(view.id)">
          {{ view.name }}
        </button>
        <button
          type="button"
          class="ml-1 grid size-4 place-items-center rounded-full text-base-content/35 hover:bg-base-200 hover:text-error"
          :aria-label="t('filters.deleteAria', { name: view.name })"
          @click.stop="tasksVM.removeView(view.id)"
        >
          <X :size="10" aria-hidden="true" />
        </button>
      </div>
      <button
        v-if="filtering"
        type="button"
        class="flex items-center gap-1 rounded-full border border-dashed border-base-300 px-2.5 py-1 text-[11px] text-base-content/50 hover:border-primary/30 hover:text-primary"
        @click="saveView"
      >
        <Plus :size="11" aria-hidden="true" />
        {{ t("filters.save") }}
      </button>
    </div>

    <AnimatePresence mode="wait" :initial="false">
      <motion.div :key="tasksVM.state.groupBy" v-bind="panelSwapMotion">
        <div v-if="shownCount" class="space-y-2">
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
                  :draggable="tasksVM.state.groupBy === 'project' && !filtering"
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
        <p
          v-else-if="!tasksVM.state.loading && filtering"
          class="px-1 text-[13px] text-base-content/40"
        >
          {{ t("filters.empty") }}
          <button
            type="button"
            class="ml-1 underline hover:text-base-content"
            @click="tasksVM.clearFilter()"
          >
            {{ t("filters.clear") }}
          </button>
        </p>
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

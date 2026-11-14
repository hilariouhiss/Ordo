<script setup lang="ts">
import { ChevronRight, GripVertical, Plus, Search, X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, ref, watch } from "vue";
import { askConfirm, askText } from "../lib/dialog";
import { localDate, shortDate, todayIso } from "../lib/dates";
import { formatEffort } from "../lib/effort";
import { t } from "../lib/i18n";
import { listItemMotion, panelSwapMotion, weekViewMotion } from "../lib/motion";
import { prefersReducedMotion } from "../lib/windowMotion";
import { NONE_GROUP_KEY, type TaskGroup, type TaskGrouping } from "../lib/taskGroups";
import type { Priority, Task } from "../model/types";
import { overdueDays } from "../model/mappers";
import { appVM } from "../viewmodels/appVM";
import { usePageHeader } from "../viewmodels/pageHeaderVM";
import { quickCreateVM } from "../viewmodels/quickCreateVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { tasksVM } from "../viewmodels/tasksVM";
import { undoVM } from "../viewmodels/undoVM";
import ChipSelect from "./components/ChipSelect.vue";
import ViewSwitch from "./components/ViewSwitch.vue";
import TaskRow from "./components/TaskRow.vue";
import TaskSheet from "./overlays/TaskSheet.vue";

const groupOptions = computed(() => [
  { value: "project", label: t("tasks.groupProject") },
  { value: "none", label: t("tasks.groupNone") },
  { value: "category", label: t("tasks.groupCategory") },
  { value: "tag", label: t("tasks.groupTag") },
  { value: "owner", label: t("tasks.groupOwner") },
  { value: "priority", label: t("tasks.groupPriority") },
]);
// A ref nested in the VM object is not unwrapped by the template.
const sections = computed(() => tasksVM.sections.value);

const modeOptions = computed(() => [
  { value: "open", label: t("tasks.modeOpen") },
  { value: "done", label: t("tasks.modeDone") },
]);
/** The two halves trade places sideways, exactly like the week's list and gantt. */
const reducedMotion = prefersReducedMotion();
const openSwap = reducedMotion ? {} : weekViewMotion(-1);
const doneSwap = reducedMotion ? {} : weekViewMotion(1);
function setMode(next: string): void {
  void tasksVM.setMode(next as "open" | "done");
}

function setGroupBy(value: string): void {
  tasksVM.setGroupBy(value as TaskGrouping);
}

/** The done list searches on its own so the open-task filter survives the switch. */
let doneTimer: ReturnType<typeof setTimeout> | undefined;
function onDoneSearch(): void {
  clearTimeout(doneTimer);
  doneTimer = setTimeout(() => void tasksVM.loadDone(), 250);
}

async function removeDone(task: { id: string; title: string }): Promise<void> {
  if (
    !(await askConfirm(
      t("archive.deleteTaskTitle"),
      t("archive.deleteTaskMessage", { title: task.title }),
    ))
  )
    return;
  await tasksVM.removeDone(task.id);
}

// A reopened or edited task leaves the done list when the sheet closes.
watch(
  () => taskSheetVM.state.openId,
  (open) => {
    if (!open && tasksVM.state.mode === "done") void tasksVM.loadDone().catch(() => {});
  },
);
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

/** The toolbar's one search field serves both halves of the page. */
const searchText = computed({
  get: () => (tasksVM.state.mode === "open" ? tasksVM.state.filter.query : tasksVM.state.doneQuery),
  set: (value: string) => {
    if (tasksVM.state.mode === "open") {
      tasksVM.state.filter.query = value;
      return;
    }
    tasksVM.state.doneQuery = value;
    onDoneSearch();
  },
});

function clearSearch(): void {
  searchText.value = "";
}

function groupEffort(group: TaskGroup): string {
  const minutes = group.tasks.reduce((sum, one) => sum + one.effortMinutes, 0);
  return formatEffort(minutes);
}

const hint = computed(() => {
  if (tasksVM.state.groupBy === "project") return t("tasks.dragProjectHint");
  if (tasksVM.state.groupBy === "tag") return t("tasks.tagHint");
  return t("tasks.hint");
});

/** The filter row is closed until used; a live filter keeps it open. */
const filtersOpen = ref(false);
const activeFilterCount = computed(
  () =>
    [
      tasksVM.state.filter.projectId,
      tasksVM.state.filter.categoryId,
      tasksVM.state.filter.ownerId,
      tasksVM.state.filter.tagId,
      tasksVM.state.filter.priority,
    ].filter(Boolean).length,
);

const openCount = computed(() => tasksVM.state.tasks.filter((one) => one.status !== "done").length);
const overdueCount = computed(
  () =>
    tasksVM.state.tasks.filter(
      (one) =>
        one.status !== "done" &&
        !one.suspended &&
        !one.waiting &&
        overdueDays(one.expectedFinishDate, todayIso()) > 0,
    ).length,
);

usePageHeader(() => ({
  title: t("nav.tasks"),
  context: `${t("tasks.count", { count: tasksVM.state.tasks.length })} · ${t("tasks.openCount", { count: openCount.value })}`,
  warning: overdueCount.value ? t("week.overdueCount", { count: overdueCount.value }) : "",
  actionLabel: t("quickCreate.taskTitle"),
  action: () => quickCreateVM.openTask(),
}));

onMounted(() => void tasksVM.load());

watch(
  () => taskSheetVM.state.openId,
  (open) => {
    if (!open) tasksVM.reload();
  },
);
// The same reload the week, archive and project pages do, so undo is visible here too.
watch(
  () => undoVM.state.revision,
  () => {
    tasksVM.reload();
  },
);

function openTask(task: Task): void {
  // Native drag usually suppresses click; WebView2 can still emit one right after.
  if (Date.now() - dragEndedAt < 200) return;
  void taskSheetVM.open(task.id);
}

function refresh(): void {
  tasksVM.reload();
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
  <section class="flex flex-col gap-3">
    <div class="flex flex-wrap items-center gap-2">
      <label
        class="flex h-8 w-60 shrink-0 items-center gap-2 rounded-md border border-base-300 bg-base-100 px-2.5"
      >
        <Search :size="14" class="shrink-0 text-base-content/55" aria-hidden="true" />
        <input
          v-model="searchText"
          class="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-base-content/55"
          :placeholder="
            tasksVM.state.mode === 'open' ? t('filters.searchPlaceholder') : t('tasks.doneSearch')
          "
          :aria-label="
            tasksVM.state.mode === 'open' ? t('filters.searchPlaceholder') : t('tasks.doneSearch')
          "
        />
        <button
          v-if="searchText"
          type="button"
          class="shrink-0 text-base-content/55 hover:text-base-content"
          :aria-label="t('filters.clearQuery')"
          @click="clearSearch"
        >
          <X :size="12" aria-hidden="true" />
        </button>
      </label>

      <ChipSelect
        v-if="tasksVM.state.mode === 'open'"
        :model-value="tasksVM.state.groupBy"
        :options="groupOptions"
        :label="t('tasks.groupByAria')"
        :dim="t('tasks.groupByShort')"
        class="select-sm h-8 w-36 shrink-0 rounded-md border border-base-300 bg-base-100 px-2.5 text-[13px]"
        @update:model-value="setGroupBy"
      />
      <button
        v-if="tasksVM.state.mode === 'open'"
        type="button"
        class="flex h-8 shrink-0 items-center gap-1 rounded-md border px-2.5 text-[13px]"
        :class="
          filtersOpen || activeFilterCount
            ? 'border-base-content/25 text-base-content'
            : 'border-base-300 text-base-content/70 hover:text-base-content'
        "
        :aria-expanded="filtersOpen"
        @click="filtersOpen = !filtersOpen"
      >
        {{ t("filters.filter") }}
        <span v-if="activeFilterCount" class="tabular-nums">· {{ activeFilterCount }}</span>
      </button>
      <button
        v-if="filtering"
        type="button"
        class="shrink-0 px-1 text-[12px] text-base-content/65 hover:text-error"
        @click="tasksVM.clearFilter()"
      >
        {{ t("filters.clear") }}
      </button>

      <ViewSwitch
        class="ml-auto"
        :label="t('tasks.modeAria')"
        :options="modeOptions"
        :model-value="tasksVM.state.mode"
        @update:model-value="setMode"
      />
    </div>

    <div
      v-if="tasksVM.state.mode === 'open' && (filtersOpen || filtering)"
      class="flex flex-wrap items-center gap-1.5"
    >
      <ChipSelect
        :model-value="tasksVM.state.filter.projectId ?? ''"
        :options="projectOptions"
        :label="t('filters.project')"
        :dim="t('filters.project')"
        class="select-sm h-8 min-w-28 flex-1 rounded-md border border-base-300 bg-base-100 px-2.5 text-[12px]"
        :class="tasksVM.state.filter.projectId ? 'text-primary' : ''"
        @update:model-value="setFacet('projectId', $event)"
      />
      <ChipSelect
        :model-value="tasksVM.state.filter.categoryId ?? ''"
        :options="categoryOptions"
        :label="t('filters.category')"
        :dim="t('filters.category')"
        class="select-sm h-8 min-w-28 flex-1 rounded-md border border-base-300 bg-base-100 px-2.5 text-[12px]"
        :class="tasksVM.state.filter.categoryId ? 'text-primary' : ''"
        @update:model-value="setFacet('categoryId', $event)"
      />
      <ChipSelect
        :model-value="tasksVM.state.filter.ownerId ?? ''"
        :options="ownerOptions"
        :label="t('filters.owner')"
        :dim="t('filters.owner')"
        class="select-sm h-8 min-w-28 flex-1 rounded-md border border-base-300 bg-base-100 px-2.5 text-[12px]"
        :class="tasksVM.state.filter.ownerId ? 'text-primary' : ''"
        @update:model-value="setFacet('ownerId', $event)"
      />
      <ChipSelect
        :model-value="tasksVM.state.filter.tagId ?? ''"
        :options="tagOptions"
        :label="t('filters.tag')"
        :dim="t('filters.tag')"
        class="select-sm h-8 min-w-28 flex-1 rounded-md border border-base-300 bg-base-100 px-2.5 text-[12px]"
        :class="tasksVM.state.filter.tagId ? 'text-primary' : ''"
        @update:model-value="setFacet('tagId', $event)"
      />
      <ChipSelect
        :model-value="tasksVM.state.filter.priority ?? ''"
        :options="priorityOptions"
        :label="t('filters.priority')"
        :dim="t('filters.priority')"
        class="select-sm h-8 min-w-28 flex-1 rounded-md border border-base-300 bg-base-100 px-2.5 text-[12px]"
        :class="tasksVM.state.filter.priority ? 'text-primary' : ''"
        @update:model-value="setPriority"
      />
    </div>

    <div v-if="savedViews.length || filtering" class="flex flex-wrap items-center gap-1.5">
      <span class="text-[11.5px] text-base-content/60">{{ t("filters.savedViews") }}</span>
      <div
        v-for="view in savedViews"
        :key="view.id"
        class="flex items-center rounded-md border pr-1 pl-2.5 text-[12px]"
        :class="
          activeViewId === view.id
            ? 'border-primary/30 bg-primary/5 text-primary'
            : 'border-base-300 bg-base-100 text-base-content/70'
        "
      >
        <button type="button" class="py-1" @click="tasksVM.applyView(view.id)">
          {{ view.name }}
        </button>
        <button
          type="button"
          class="ml-1 grid size-4 place-items-center rounded text-base-content/50 hover:bg-base-200 hover:text-error"
          :aria-label="t('filters.deleteAria', { name: view.name })"
          @click.stop="tasksVM.removeView(view.id)"
        >
          <X :size="10" aria-hidden="true" />
        </button>
      </div>
      <button
        v-if="filtering"
        type="button"
        class="flex items-center gap-1 rounded-md border border-dashed border-base-300 px-2.5 py-1 text-[12px] text-base-content/65 hover:border-primary/30 hover:text-primary"
        @click="saveView"
      >
        <Plus :size="11" aria-hidden="true" />
        {{ t("filters.save") }}
      </button>
    </div>

    <p
      v-if="tasksVM.state.mode === 'open' && tasksVM.state.groupBy === 'project' && !filtering"
      class="text-[11.5px] text-base-content/60"
    >
      {{ hint }}
    </p>

    <AnimatePresence mode="wait" :initial="false">
      <motion.div v-if="tasksVM.state.mode === 'open'" key="open" v-bind="openSwap">
        <AnimatePresence mode="wait" :initial="false">
          <motion.div :key="tasksVM.state.groupBy" v-bind="panelSwapMotion">
            <div v-if="shownCount" class="space-y-3">
              <section
                v-for="group in sections"
                :key="group.key"
                :class="
                  tasksVM.state.groupBy === 'project' && dragOverGroup === group.key
                    ? 'rounded-lg bg-primary/5 ring-2 ring-primary/30'
                    : ''
                "
                @dragover="onGroupDragOver($event, group)"
                @dragleave="onGroupDragLeave($event, group)"
                @drop="onGroupDrop($event, group)"
              >
                <div class="overflow-hidden rounded-lg bg-base-100">
                  <h2 v-if="tasksVM.state.groupBy !== 'none'">
                    <button
                      type="button"
                      class="flex w-full cursor-pointer items-center gap-2 border-b border-base-200 px-3 py-2 text-left text-[13px] hover:bg-base-200/50 focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:outline-none"
                      :aria-expanded="!tasksVM.isGroupCollapsed(group.key)"
                      :aria-controls="groupListId(group.key)"
                      :aria-label="
                        t(
                          tasksVM.isGroupCollapsed(group.key)
                            ? 'tasks.expandGroup'
                            : 'tasks.collapseGroup',
                          { name: group.name },
                        )
                      "
                      @click="tasksVM.toggleGroup(group.key)"
                    >
                      <ChevronRight
                        :size="13"
                        aria-hidden="true"
                        class="shrink-0 text-base-content/55 transition-transform duration-150"
                        :class="{ 'rotate-90': !tasksVM.isGroupCollapsed(group.key) }"
                      />
                      <span class="font-medium">{{ group.name }}</span>
                      <span class="tabular-nums text-base-content/55">{{
                        group.tasks.length
                      }}</span>
                      <span class="ml-auto text-[11.5px] text-base-content/55">{{
                        groupEffort(group)
                      }}</span>
                    </button>
                  </h2>
                  <div :id="groupListId(group.key)">
                    <AnimatePresence
                      v-if="
                        tasksVM.state.groupBy === 'none' || !tasksVM.isGroupCollapsed(group.key)
                      "
                      as="ul"
                      mode="popLayout"
                      :initial="false"
                      class="divide-y divide-base-200"
                    >
                      <TaskRow
                        v-for="task in group.tasks"
                        :key="task.id"
                        :task="task"
                        :show-project="tasksVM.state.groupBy !== 'project'"
                        :draggable="tasksVM.state.groupBy === 'project' && !filtering"
                        :dimmed="draggingTaskId === task.id"
                        @open="openTask"
                        @changed="refresh"
                        @drag-start="onTaskDragStart"
                        @drag-end="onTaskDragEnd"
                      >
                        <template #leading>
                          <span
                            v-if="tasksVM.state.groupBy === 'project'"
                            class="cursor-grab text-base-content/25 active:cursor-grabbing"
                            :title="t('tasks.dragProjectHint')"
                            aria-hidden="true"
                            @click.stop
                          >
                            <GripVertical :size="13" />
                          </span>
                        </template>
                      </TaskRow>
                    </AnimatePresence>
                  </div>
                </div>
              </section>
            </div>
            <p
              v-else-if="!tasksVM.state.loading && filtering"
              class="text-[13px] text-base-content/65"
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
            <p v-else-if="!tasksVM.state.loading" class="text-[13px] text-base-content/65">
              {{ t("tasks.empty") }}
            </p>
          </motion.div>
        </AnimatePresence>
      </motion.div>

      <motion.div v-else key="done" v-bind="doneSwap" class="space-y-3">
        <AnimatePresence
          as="ul"
          mode="popLayout"
          :initial="false"
          class="divide-y divide-base-200 overflow-hidden rounded-lg bg-base-100"
        >
          <motion.li
            v-for="task in tasksVM.state.done"
            :key="task.id"
            v-bind="listItemMotion"
            class="flex h-11 cursor-pointer items-center gap-3 px-3 text-[13px] hover:bg-base-200/60"
            @click="taskSheetVM.open(task.id)"
          >
            <span class="min-w-0 flex-1 truncate text-base-content/70">{{ task.title }}</span>
            <span
              v-if="task.actualFinishAt"
              class="shrink-0 text-[11.5px] tabular-nums text-base-content/55"
            >
              {{ t("tasks.doneAt", { date: shortDate(localDate(task.actualFinishAt)) }) }}
            </span>
            <button
              type="button"
              class="shrink-0 text-[12px] text-base-content/65 hover:text-base-content"
              @click.stop="tasksVM.restoreDone(task.id)"
            >
              {{ t("common.restore") }}
            </button>
            <button
              type="button"
              class="shrink-0 text-[12px] text-base-content/65 hover:text-error"
              @click.stop="removeDone(task)"
            >
              {{ t("common.delete") }}
            </button>
          </motion.li>
        </AnimatePresence>
        <p v-if="!tasksVM.state.done.length" class="text-[13px] text-base-content/65">
          {{ t("tasks.doneEmpty") }}
        </p>
        <p class="text-[11.5px] text-base-content/60">{{ t("tasks.doneFooter") }}</p>
      </motion.div>
    </AnimatePresence>

    <AnimatePresence>
      <TaskSheet v-if="taskSheetVM.state.openId" key="task-sheet" />
    </AnimatePresence>
  </section>
</template>

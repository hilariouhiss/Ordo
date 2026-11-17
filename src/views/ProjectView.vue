<script setup lang="ts">
import { Check, Diamond, Ellipsis, Plus, X } from "@lucide/vue";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion-v";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { todayIso } from "../lib/dates";
import { errorText, t } from "../lib/i18n";
import { isImeEnter } from "../lib/keys";
import { panelSwapMotion, springSoft } from "../lib/motion";
import type { Milestone, Task } from "../model/types";
import { appVM } from "../viewmodels/appVM";
import { issuesVM } from "../viewmodels/issuesVM";
import { createProjectVM } from "../viewmodels/projectVM";
import { usePageHeader } from "../viewmodels/pageHeaderVM";
import { projectsVM } from "../viewmodels/projectsVM";
import { requirementsVM } from "../viewmodels/requirementsVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import { undoVM } from "../viewmodels/undoVM";
import CaptureBar from "./components/CaptureBar.vue";
import CategoryProgress from "./components/CategoryProgress.vue";
import DateField from "./components/DateField.vue";
import IssuesPanel from "./components/IssuesPanel.vue";
import RequirementsPanel from "./components/RequirementsPanel.vue";
import SummaryLine from "./components/SummaryLine.vue";
import TaskRow from "./components/TaskRow.vue";
import TimelineView from "./components/TimelineView.vue";
import ProjectSettings from "./overlays/ProjectSettings.vue";
import TaskSheet from "./overlays/TaskSheet.vue";

const props = defineProps<{ id: string }>();
const router = useRouter();
const vm = createProjectVM();
// The shared settings state keeps the global shortcut guard and closeOverlays working here too.
const settingsOpen = computed(() => projectsVM.state.settingsFor === props.id);
let unlistenAi: (() => void) | undefined;
let unlistenCapture: (() => void) | undefined;
let unlistenTasks: (() => void) | undefined;

onMounted(async () => {
  reloadPage();
  if (!isTauri()) return;
  unlistenAi = await listen("ai:enriched", () => {
    reloadPage();
    void appVM.load();
  });
  unlistenCapture = await listen("capture:created", () => {
    reloadPage();
  });
  unlistenTasks = await listen("tasks:changed", () => {
    reloadPage();
  });
});

onUnmounted(() => {
  unlistenAi?.();
  unlistenCapture?.();
  unlistenTasks?.();
  if (projectsVM.state.settingsFor === props.id) projectsVM.closeSettings();
});

watch(
  () => taskSheetVM.state.openId,
  (open) => {
    if (!open) reloadPage();
  },
);

/** The project page, the requirement tab and the issue tab read the same ledger. */
function reloadPage(): void {
  void vm.load(props.id);
  void requirementsVM.load(props.id);
  void issuesVM.load(props.id);
}

function focusIssue(id: string): void {
  vm.state.view = "issue";
  issuesVM.focus(id);
}

function focusRequirement(id: string): void {
  vm.state.view = "requirement";
  requirementsVM.focus(id);
}

const today = todayIso();
usePageHeader(() => ({
  title: vm.state.summary?.name ?? t("nav.projects"),
  context: vm.state.summary ? `${vm.state.summary.done}/${vm.state.summary.total}` : "",
}));
const milestoneTitle = ref("");
const milestoneDate = ref("");
const editingId = ref<string | null>(null);
const editingTitle = ref("");
const editInput = ref<HTMLInputElement | null>(null);

function setEditInput(element: unknown): void {
  if (element instanceof HTMLInputElement) editInput.value = element;
}

async function addMilestone(): Promise<void> {
  if (!milestoneTitle.value.trim()) return;
  const saved = await vm.addMilestone(props.id, milestoneTitle.value, milestoneDate.value);
  if (!saved) return;
  milestoneTitle.value = "";
  milestoneDate.value = "";
}

function onAddMilestoneKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void addMilestone();
}

function startRename(milestone: Milestone): void {
  editingId.value = milestone.id;
  editingTitle.value = milestone.title;
  void nextTick(() => editInput.value?.focus());
}

function cancelRename(): void {
  editingId.value = null;
  editingTitle.value = "";
}

async function commitRename(milestone: Milestone): Promise<void> {
  if (editingId.value !== milestone.id) return;
  const title = editingTitle.value.trim();
  editingId.value = null;
  editingTitle.value = "";
  if (!title || title === milestone.title) return;
  await vm.renameMilestone(props.id, milestone, title);
}

function onRenameKey(event: KeyboardEvent, milestone: Milestone): void {
  if (event.key === "Escape") {
    cancelRename();
    return;
  }
  if (isImeEnter(event)) return;
  void commitRename(milestone);
}

function toggleMilestone(milestone: Milestone): void {
  void vm.toggleMilestone(props.id, milestone);
}

function changeMilestoneDate(milestone: Milestone, dueDate: string): void {
  void vm.setMilestoneDate(props.id, milestone, dueDate);
}

function removeMilestone(milestone: Milestone): void {
  void vm.removeMilestone(props.id, milestone.id);
}

function milestoneOverdue(milestone: Milestone): boolean {
  return milestone.dueDate !== null && !milestone.doneAt && milestone.dueDate < today;
}

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

function refresh(): void {
  reloadPage();
}

function closeSettings(gone = false): void {
  projectsVM.closeSettings();
  if (gone) void router.push("/projects");
  else void vm.load(props.id);
}
// Reusing this component for another project must not carry a draft, an open
// rename, or an error across the switch.
watch(
  () => props.id,
  (id) => {
    milestoneTitle.value = "";
    milestoneDate.value = "";
    cancelRename();
    vm.state.milestoneError = null;
    void vm.load(id);
    void requirementsVM.load(id);
    void issuesVM.load(id);
  },
);
watch(
  () => undoVM.state.revision,
  () => {
    reloadPage();
  },
);
</script>

<template>
  <section v-if="vm.state.summary" class="space-y-2">
    <div class="flex flex-wrap items-center gap-3 px-1">
      <span class="h-1 min-w-32 flex-1 overflow-hidden rounded-full bg-base-300">
        <motion.span
          class="block h-full rounded-full bg-primary"
          :initial="{ width: 0 }"
          :animate="{ width: progressPct + '%' }"
          :transition="springSoft"
        ></motion.span>
      </span>
      <span class="text-[12px] tabular-nums text-base-content/70">
        {{ vm.state.summary.done }}/{{ vm.state.summary.total }}
      </span>
      <div role="tablist" class="tabs tabs-border tabs-xs">
        <button
          role="tab"
          class="tab"
          :class="{ 'tab-active': vm.state.view === 'group' }"
          @click="vm.state.view = 'group'"
        >
          {{ t("project.group") }}
        </button>
        <button
          role="tab"
          class="tab"
          :class="{ 'tab-active': vm.state.view === 'timeline' }"
          @click="vm.state.view = 'timeline'"
        >
          {{ t("project.timeline") }}
        </button>
        <button
          role="tab"
          class="tab"
          :class="{ 'tab-active': vm.state.view === 'requirement' }"
          @click="vm.state.view = 'requirement'"
        >
          {{ t("project.requirements") }}
        </button>
        <button
          role="tab"
          class="tab"
          :class="{ 'tab-active': vm.state.view === 'issue' }"
          @click="vm.state.view = 'issue'"
        >
          {{ t("project.issues") }}
        </button>
      </div>
      <button
        type="button"
        class="text-base-content/60 hover:text-base-content"
        :aria-label="t('project.settingsAria')"
        @click="projectsVM.openSettings(props.id)"
      >
        <Ellipsis :size="16" aria-hidden="true" />
      </button>
    </div>

    <div
      v-if="vm.state.view !== 'requirement' && vm.state.view !== 'issue'"
      class="rounded-xl bg-base-100 px-3 py-2"
    >
      <div class="text-[12px] font-semibold">{{ t("milestones.title") }}</div>

      <ul v-if="vm.state.milestones.length" class="mt-0.5">
        <li
          v-for="milestone in vm.state.milestones"
          :key="milestone.id"
          class="group flex items-center gap-2 border-t border-base-200 py-1.5 text-[13px] first:border-t-0"
        >
          <button
            type="button"
            class="shrink-0 text-primary"
            :aria-pressed="milestone.doneAt !== null"
            :aria-label="
              milestone.doneAt
                ? t('milestones.markOpenAria', { title: milestone.title })
                : t('milestones.markDoneAria', { title: milestone.title })
            "
            @click="toggleMilestone(milestone)"
          >
            <Check v-if="milestone.doneAt" :size="12" aria-hidden="true" />
            <Diamond v-else :size="11" aria-hidden="true" />
          </button>

          <input
            v-if="editingId === milestone.id"
            :ref="setEditInput"
            v-model="editingTitle"
            class="min-w-0 flex-1 rounded-md border border-base-300 bg-base-100 px-1.5 py-0.5 text-[13px] outline-none focus:border-primary/60"
            :aria-label="t('milestones.renameAria', { title: milestone.title })"
            @blur="commitRename(milestone)"
            @keydown="onRenameKey($event, milestone)"
          />
          <button
            v-else
            type="button"
            class="min-w-0 flex-1 truncate text-left"
            :class="{ 'text-base-content/60 line-through': milestone.doneAt }"
            @click="startRename(milestone)"
          >
            {{ milestone.title }}
          </button>

          <DateField
            class="w-[92px] shrink-0 text-[12px]"
            :class="milestoneOverdue(milestone) ? 'text-error' : 'text-base-content/65'"
            :model-value="milestone.dueDate ?? ''"
            :aria-label="t('milestones.dateAria', { title: milestone.title })"
            @update:model-value="changeMilestoneDate(milestone, $event)"
          />

          <button
            type="button"
            class="shrink-0 text-base-content/25 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
            :aria-label="t('milestones.removeAria', { title: milestone.title })"
            @click="removeMilestone(milestone)"
          >
            <X :size="12" aria-hidden="true" />
          </button>
        </li>
      </ul>

      <div class="flex items-center gap-2 border-t border-base-200 pt-2 text-[13px]">
        <Plus :size="11" class="shrink-0 text-base-content/60" aria-hidden="true" />
        <input
          v-model="milestoneTitle"
          class="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-base-content/60"
          :placeholder="t('milestones.placeholder')"
          @keydown.enter="onAddMilestoneKey"
        />
        <DateField
          v-model="milestoneDate"
          class="w-[92px] shrink-0 text-[12px] text-base-content/65"
          :aria-label="t('milestones.addDateAria')"
          @enter="addMilestone"
        />
        <button
          type="button"
          class="btn btn-xs shrink-0 rounded-md border-0 bg-base-content font-medium text-base-100"
          @click="addMilestone"
        >
          {{ t("milestones.add") }}
        </button>
      </div>

      <p v-if="vm.state.milestoneError" class="mt-1.5 text-[12px] text-error">
        {{ errorText(vm.state.milestoneError) }}
      </p>
    </div>

    <CaptureBar
      v-if="vm.state.view !== 'requirement' && vm.state.view !== 'issue'"
      v-model="vm.state.draft"
      :project-id="props.id"
      @submit="vm.captureInto(props.id, $event)"
    />

    <AnimatePresence mode="wait" :initial="false">
      <motion.div
        v-if="vm.state.view === 'group'"
        key="group"
        v-bind="panelSwapMotion"
        class="space-y-2"
      >
        <CategoryProgress
          v-for="category in vm.state.summary.byCategory"
          :key="category.categoryId"
          :category="category"
          :expanded="!!vm.state.expanded[category.categoryId]"
          @toggle="vm.toggle(category.categoryId)"
        >
          <AnimatePresence
            as="ul"
            mode="popLayout"
            :initial="false"
            class="divide-y divide-base-200"
          >
            <TaskRow
              v-for="task in tasksByCategory.get(category.categoryId) ?? []"
              :key="task.id"
              :task="task"
              :show-project="false"
              @open="openTask"
              @changed="refresh"
            />
          </AnimatePresence>
        </CategoryProgress>

        <div
          v-if="(tasksByCategory.get('') ?? []).length"
          class="rounded-xl bg-base-100 px-3 py-2.5"
        >
          <div class="text-[12px] font-medium tracking-wide text-base-content/60">
            {{ t("common.uncategorized") }}
          </div>
          <AnimatePresence
            as="ul"
            mode="popLayout"
            :initial="false"
            class="divide-y divide-base-200"
          >
            <TaskRow
              v-for="task in tasksByCategory.get('') ?? []"
              :key="task.id"
              :task="task"
              :show-project="false"
              @open="openTask"
              @changed="refresh"
            />
          </AnimatePresence>
        </div>
      </motion.div>

      <motion.div v-else-if="vm.state.view === 'timeline'" key="timeline" v-bind="panelSwapMotion">
        <TimelineView :tasks="vm.state.tasks" :milestones="vm.state.milestones" />
      </motion.div>

      <motion.div
        v-else-if="vm.state.view === 'requirement'"
        key="requirement"
        v-bind="panelSwapMotion"
      >
        <RequirementsPanel
          :project-id="props.id"
          :tasks="vm.state.tasks"
          @changed="refresh"
          @focus-issue="focusIssue"
        />
      </motion.div>

      <motion.div v-else key="issue" v-bind="panelSwapMotion">
        <IssuesPanel
          :project-id="props.id"
          :tasks="vm.state.tasks"
          :requirements="requirementsVM.state.requirements"
          @changed="refresh"
          @focus-requirement="focusRequirement"
        />
      </motion.div>
    </AnimatePresence>

    <SummaryLine :text="vm.summaryLine.value" :copied="vm.state.copied" @copy="vm.copySummary" />

    <AnimatePresence>
      <TaskSheet v-if="taskSheetVM.state.openId" key="task-sheet" />
    </AnimatePresence>
    <AnimatePresence>
      <ProjectSettings v-if="settingsOpen" :id="props.id" @close="closeSettings" />
    </AnimatePresence>
  </section>
</template>

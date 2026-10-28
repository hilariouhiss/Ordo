<script setup lang="ts">
import { Ellipsis } from "@lucide/vue";
import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRouter } from "vue-router";
import { t } from "../lib/i18n";
import { panelSwapMotion, springSoft } from "../lib/motion";
import type { Task } from "../model/types";
import { appVM } from "../viewmodels/appVM";
import { createProjectVM } from "../viewmodels/projectVM";
import { projectsVM } from "../viewmodels/projectsVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import CaptureBar from "./components/CaptureBar.vue";
import CategoryProgress from "./components/CategoryProgress.vue";
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

onMounted(async () => {
  void vm.load(props.id);
  if (!isTauri()) return;
  unlistenAi = await listen("ai:enriched", () => {
    void vm.load(props.id);
    void appVM.load();
  });
  unlistenCapture = await listen("capture:created", () => {
    void vm.load(props.id);
  });
});

onUnmounted(() => {
  unlistenAi?.();
  unlistenCapture?.();
  if (projectsVM.state.settingsFor === props.id) projectsVM.closeSettings();
});

watch(
  () => taskSheetVM.state.openId,
  (open) => {
    if (!open) void vm.load(props.id);
  },
);

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
  void vm.load(props.id);
}

function closeSettings(gone = false): void {
  projectsVM.closeSettings();
  if (gone) void router.push("/projects");
  else void vm.load(props.id);
}
</script>

<template>
  <section v-if="vm.state.summary" class="space-y-2">
    <div class="flex items-start gap-3">
      <div class="text-[16px] font-semibold tracking-tight">{{ vm.state.summary.name }}</div>
      <div class="ml-auto flex items-center gap-2">
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
        </div>
        <button
          class="text-base-content/35"
          :aria-label="t('project.settingsAria')"
          @click="projectsVM.openSettings(props.id)"
        >
          <Ellipsis :size="15" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="flex items-center gap-3 px-1">
      <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-base-300">
        <motion.span
          class="block h-full rounded-full bg-primary"
          :initial="{ width: 0 }"
          :animate="{ width: progressPct + '%' }"
          :transition="springSoft"
        ></motion.span>
      </span>
      <span class="text-[11.5px] tabular-nums text-base-content/55">
        {{ vm.state.summary.done }}/{{ vm.state.summary.total }}
      </span>
    </div>

    <CaptureBar
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
          <AnimatePresence as="ul" mode="popLayout" :initial="false" class="mt-1.5 space-y-1">
            <TaskRow
              v-for="task in tasksByCategory.get(category.categoryId) ?? []"
              :key="task.id"
              :task="task"
              @open="openTask"
              @changed="refresh"
            />
          </AnimatePresence>
        </CategoryProgress>

        <div
          v-if="(tasksByCategory.get('') ?? []).length"
          class="rounded-xl bg-base-100 px-3 py-2.5"
        >
          <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">
            {{ t("common.uncategorized") }}
          </div>
          <AnimatePresence as="ul" mode="popLayout" :initial="false" class="mt-1.5 space-y-1">
            <TaskRow
              v-for="task in tasksByCategory.get('') ?? []"
              :key="task.id"
              :task="task"
              @open="openTask"
              @changed="refresh"
            />
          </AnimatePresence>
        </div>
      </motion.div>

      <motion.div v-else key="timeline" v-bind="panelSwapMotion">
        <TimelineView :tasks="vm.state.tasks" />
      </motion.div>
    </AnimatePresence>

    <SummaryLine :text="vm.summaryLine.value" :copied="vm.state.copied" @copy="vm.copySummary" />

    <AnimatePresence>
      <TaskSheet v-if="taskSheetVM.state.openId" />
    </AnimatePresence>
    <AnimatePresence>
      <ProjectSettings v-if="settingsOpen" :id="props.id" @close="closeSettings" />
    </AnimatePresence>
  </section>
</template>

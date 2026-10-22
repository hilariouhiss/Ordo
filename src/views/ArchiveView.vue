<script setup lang="ts">
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, watch } from "vue";
import { shortDate } from "../lib/dates";
import { askConfirm } from "../lib/dialog";
import { t } from "../lib/i18n";
import { listItemMotion } from "../lib/motion";
import { archiveVM as vm } from "../viewmodels/archiveVM";
import { taskSheetVM } from "../viewmodels/taskSheetVM";
import TaskSheet from "./overlays/TaskSheet.vue";

onMounted(() => {
  void vm.load();
});

watch(
  () => taskSheetVM.state.openId,
  (open) => {
    if (!open) void vm.load();
  },
);

const currentList = computed(() =>
  vm.state.tab === "tasks"
    ? vm.state.data.tasks
    : vm.state.tab === "done"
      ? vm.state.data.done
      : vm.state.data.canceled,
);

let timer: ReturnType<typeof setTimeout> | undefined;
function onSearch(): void {
  clearTimeout(timer);
  timer = setTimeout(() => void vm.load(), 250);
}

async function removeTask(id: string, title: string): Promise<void> {
  const ok = await askConfirm(
    t("archive.deleteTaskTitle"),
    t("archive.deleteTaskMessage", { title }),
  );
  if (ok) await vm.remove(id);
}

async function removeProject(id: string, name: string): Promise<void> {
  const ok = await askConfirm(
    t("archive.deleteProjectTitle"),
    t("archive.deleteProjectMessage", { name }),
  );
  if (ok) await vm.removeProject(id);
}

function openTask(id: string): void {
  void taskSheetVM.open(id);
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">{{ t("archive.title") }}</h1>
      <div class="input input-sm ml-auto w-56 rounded-lg border-0 bg-base-100">
        <input
          v-model="vm.state.query"
          class="w-full bg-transparent text-[12px] outline-none placeholder:text-base-content/35"
          :placeholder="t('archive.search')"
          @input="onSearch"
        />
      </div>
    </div>

    <div role="tablist" class="tabs tabs-border tabs-sm">
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': vm.state.tab === 'projects' }"
        @click="vm.state.tab = 'projects'"
      >
        {{ t("archive.projects", { count: vm.state.data.projects.length }) }}
      </button>
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': vm.state.tab === 'tasks' }"
        @click="vm.state.tab = 'tasks'"
      >
        {{ t("archive.tasks", { count: vm.state.data.tasks.length }) }}
      </button>
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': vm.state.tab === 'canceled' }"
        @click="vm.state.tab = 'canceled'"
      >
        {{ t("archive.canceled", { count: vm.state.data.canceled.length }) }}
      </button>
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': vm.state.tab === 'done' }"
        @click="vm.state.tab = 'done'"
      >
        {{ t("archive.done", { count: vm.state.data.done.length }) }}
      </button>
    </div>

    <div v-if="vm.state.tab === 'projects'" class="space-y-1.5">
      <AnimatePresence mode="popLayout" :initial="false">
        <motion.div
          v-for="project in vm.state.data.projects"
          :key="project.id"
          v-bind="listItemMotion"
          class="flex items-center gap-3 rounded-xl bg-base-100 px-4 py-2.5"
        >
          <span class="text-[13px] font-medium">{{ project.name }}</span>
          <span v-if="project.dueDate" class="text-[10.5px] text-base-content/40">
            {{ t("projects.due", { date: shortDate(project.dueDate) }) }}
          </span>
          <button
            class="btn btn-xs ml-auto rounded-md border-base-300 bg-base-200 font-normal"
            @click="vm.restoreProject(project.id)"
          >
            {{ t("common.restore") }}
          </button>
          <button
            class="btn btn-xs rounded-md border-error/25 bg-base-100 font-normal text-error"
            @click="removeProject(project.id, project.name)"
          >
            {{ t("common.delete") }}
          </button>
        </motion.div>
      </AnimatePresence>
      <p v-if="!vm.state.data.projects.length" class="px-1 text-[12px] text-base-content/40">
        {{ t("archive.emptyProjects") }}
      </p>
    </div>

    <div v-else class="space-y-1.5">
      <AnimatePresence mode="popLayout" :initial="false">
        <motion.div
          v-for="task in currentList"
          :key="task.id"
          v-bind="listItemMotion"
          class="flex items-center gap-3 rounded-xl bg-base-100 px-4 py-2.5"
          :class="{ 'cursor-pointer': vm.state.tab === 'done' }"
          @click="vm.state.tab === 'done' && openTask(task.id)"
        >
          <span class="text-[13px] text-base-content/70">{{ task.title }}</span>
          <span v-if="task.canceledAt" class="badge badge-ghost badge-xs">{{
            t("archive.canceledBadge")
          }}</span>
          <button
            class="btn btn-xs ml-auto rounded-md border-base-300 bg-base-200 font-normal"
            @click.stop="vm.restore(task.id)"
          >
            {{ t("common.restore") }}
          </button>
          <button
            v-if="!task.archivedAt && !task.canceledAt"
            class="btn btn-xs rounded-md border-base-300 bg-base-200 font-normal"
            :title="t('archive.archiveOnlyTitle')"
            @click.stop="vm.archive(task.id)"
          >
            {{ t("common.archive") }}
          </button>
          <button
            v-else
            class="btn btn-xs rounded-md border-error/25 bg-base-100 font-normal text-error"
            @click.stop="removeTask(task.id, task.title)"
          >
            {{ t("common.delete") }}
          </button>
        </motion.div>
      </AnimatePresence>
      <p v-if="!currentList.length" class="px-1 text-[12px] text-base-content/40">
        {{ t("archive.empty") }}
      </p>
    </div>

    <AnimatePresence>
      <TaskSheet v-if="taskSheetVM.state.openId" />
    </AnimatePresence>
  </section>
</template>

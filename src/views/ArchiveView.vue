<script setup lang="ts">
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted } from "vue";
import { shortDate } from "../lib/dates";
import { askConfirm } from "../lib/dialog";
import { listItemMotion } from "../lib/motion";
import { archiveVM as vm } from "../viewmodels/archiveVM";

onMounted(() => {
  void vm.load();
});

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
    "删除任务",
    `永久删除「${title}」？步骤和延期记录会一起删掉，不能撤销。`,
  );
  if (ok) await vm.remove(id);
}

async function removeProject(id: string, name: string): Promise<void> {
  const ok = await askConfirm(
    "删除项目",
    `永久删除项目「${name}」？里面的任务会一起消失，不能撤销。`,
  );
  if (ok) await vm.removeProject(id);
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">归档</h1>
      <div class="input input-sm ml-auto w-56 rounded-lg border-0 bg-base-100">
        <input
          v-model="vm.state.query"
          class="w-full bg-transparent text-[12px] outline-none placeholder:text-base-content/35"
          placeholder="搜任务或项目…"
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
        项目 {{ vm.state.data.projects.length }}
      </button>
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': vm.state.tab === 'tasks' }"
        @click="vm.state.tab = 'tasks'"
      >
        任务 {{ vm.state.data.tasks.length }}
      </button>
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': vm.state.tab === 'canceled' }"
        @click="vm.state.tab = 'canceled'"
      >
        已取消 {{ vm.state.data.canceled.length }}
      </button>
      <button
        role="tab"
        class="tab"
        :class="{ 'tab-active': vm.state.tab === 'done' }"
        @click="vm.state.tab = 'done'"
      >
        已完成 {{ vm.state.data.done.length }}
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
            截止 {{ shortDate(project.dueDate) }}
          </span>
          <button
            class="btn btn-xs ml-auto rounded-md border-base-300 bg-base-200 font-normal"
            @click="vm.restoreProject(project.id)"
          >
            恢复
          </button>
          <button
            class="btn btn-xs rounded-md border-error/25 bg-base-100 font-normal text-error"
            @click="removeProject(project.id, project.name)"
          >
            删除
          </button>
        </motion.div>
      </AnimatePresence>
      <p v-if="!vm.state.data.projects.length" class="px-1 text-[12px] text-base-content/40">
        没有归档的项目。
      </p>
    </div>

    <div v-else class="space-y-1.5">
      <AnimatePresence mode="popLayout" :initial="false">
        <motion.div
          v-for="task in currentList"
          :key="task.id"
          v-bind="listItemMotion"
          class="flex items-center gap-3 rounded-xl bg-base-100 px-4 py-2.5"
        >
          <span class="text-[13px] text-base-content/70">{{ task.title }}</span>
          <span v-if="task.canceledAt" class="badge badge-ghost badge-xs">已取消</span>
          <button
            class="btn btn-xs ml-auto rounded-md border-base-300 bg-base-200 font-normal"
            @click="vm.restore(task.id)"
          >
            恢复
          </button>
          <button
            v-if="!task.archivedAt && !task.canceledAt"
            class="btn btn-xs rounded-md border-base-300 bg-base-200 font-normal"
            title="归档后才能永久删除"
            @click="vm.archive(task.id)"
          >
            归档
          </button>
          <button
            v-else
            class="btn btn-xs rounded-md border-error/25 bg-base-100 font-normal text-error"
            @click="removeTask(task.id, task.title)"
          >
            删除
          </button>
        </motion.div>
      </AnimatePresence>
      <p v-if="!currentList.length" class="px-1 text-[12px] text-base-content/40">
        这里还没有东西。
      </p>
    </div>
  </section>
</template>

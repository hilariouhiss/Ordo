<script setup lang="ts">
import { Ellipsis } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { shortDate } from "../lib/dates";
import { isImeEnter } from "../lib/keys";
import { listItemMotion } from "../lib/motion";
import { projectsVM } from "../viewmodels/projectsVM";
import ProjectSettings from "./overlays/ProjectSettings.vue";

const router = useRouter();
const name = ref("");
const dueDate = ref("");

onMounted(() => {
  void projectsVM.load();
});

async function create(): Promise<void> {
  const project = await projectsVM.create(name.value, dueDate.value || null);
  if (project) {
    name.value = "";
    dueDate.value = "";
  }
}

function onCreateKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void create();
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-2 rounded-xl bg-base-100 px-4 py-2.5">
      <input
        v-model="name"
        class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/40"
        placeholder="新项目名…"
        @keydown.enter="onCreateKey"
      />
      <input v-model="dueDate" type="date" class="input input-xs rounded-lg border-base-300" />
      <button
        class="btn btn-sm shrink-0 rounded-lg border-0 bg-primary text-primary-content"
        @click="create"
      >
        新建
      </button>
    </div>

    <AnimatePresence
      v-if="projectsVM.state.projects.length"
      as="ul"
      mode="popLayout"
      :initial="false"
      class="space-y-1.5"
    >
      <motion.li
        v-for="project in projectsVM.state.projects"
        :key="project.id"
        v-bind="listItemMotion"
        class="flex cursor-pointer items-center gap-3 rounded-xl bg-base-100 px-4 py-3 hover:opacity-90"
        @click="router.push(`/projects/${project.id}`)"
      >
        <span class="text-[13.5px] font-medium">{{ project.name }}</span>
        <span v-if="project.dueDate" class="badge badge-ghost badge-xs">
          截止 {{ shortDate(project.dueDate) }}
        </span>
        <span class="ml-auto text-[11px] tabular-nums text-base-content/45">
          {{ project.done }}/{{ project.total }}
        </span>
        <button
          class="text-base-content/35"
          aria-label="项目设置"
          @click.stop="projectsVM.openSettings(project.id)"
        >
          <Ellipsis :size="14" aria-hidden="true" />
        </button>
      </motion.li>
    </AnimatePresence>

    <p v-else-if="!projectsVM.state.loading" class="px-1 text-[13px] text-base-content/40">
      还没有项目。在上面建一个。
    </p>

    <AnimatePresence>
      <ProjectSettings
        v-if="projectsVM.state.settingsFor"
        :id="projectsVM.state.settingsFor"
        @close="projectsVM.closeSettings()"
      />
    </AnimatePresence>
  </section>
</template>

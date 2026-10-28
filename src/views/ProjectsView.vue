<script setup lang="ts">
import { Ellipsis, GripVertical, Trash } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { useRouter } from "vue-router";
import { askConfirm, askText } from "../lib/dialog";
import { errorText, language, t } from "../lib/i18n";
import { isImeEnter } from "../lib/keys";
import { listItemMotion } from "../lib/motion";
import { projectSections, type ProjectSection } from "../lib/projectGroups";
import type { ProjectGroup, ProjectSummary } from "../model/types";
import { projectsVM } from "../viewmodels/projectsVM";
import PriorityBadge from "./components/PriorityBadge.vue";
import ProjectSettings from "./overlays/ProjectSettings.vue";

const router = useRouter();
const name = ref("");
const error = ref("");
const draggingId = ref<string | null>(null);
const dragOverGroupId = ref<string | null>(null);

onMounted(() => {
  void projectsVM.load();
});

// The settings modal belongs to this page; leaving it open would block the shortcut elsewhere.
onUnmounted(() => projectsVM.closeSettings());

async function create(): Promise<void> {
  error.value = "";
  try {
    const project = await projectsVM.create(name.value);
    if (project) name.value = "";
  } catch (e) {
    error.value = String(e);
  }
}

function onCreateKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void create();
}

const sections = computed(() =>
  projectSections(
    projectsVM.state.projects,
    projectsVM.state.groups,
    t("projects.ungrouped"),
    language.value,
  ),
);

function canDrag(section: ProjectSection): boolean {
  return section.group === null && projectsVM.state.groups.length > 0;
}

function onDragStart(project: ProjectSummary, section: ProjectSection, event: DragEvent): void {
  if (!canDrag(section)) {
    event.preventDefault();
    return;
  }
  draggingId.value = project.id;
  dragOverGroupId.value = null;
  event.dataTransfer?.setData("text/plain", project.id);
  if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
}

function onDragEnd(): void {
  draggingId.value = null;
  dragOverGroupId.value = null;
}

function onGroupDragOver(groupId: string | null, event: DragEvent): void {
  if (!groupId || !draggingId.value) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
  dragOverGroupId.value = groupId;
}

function onGroupDragLeave(groupId: string | null, event: DragEvent): void {
  if (!groupId || dragOverGroupId.value !== groupId) return;
  const section = event.currentTarget as HTMLElement | null;
  const under = document.elementFromPoint(event.clientX, event.clientY);
  if (section && under && section.contains(under)) return;
  dragOverGroupId.value = null;
}

async function onGroupDrop(groupId: string | null, event: DragEvent): Promise<void> {
  if (!groupId) return;
  event.preventDefault();
  const id = draggingId.value ?? event.dataTransfer?.getData("text/plain") ?? null;
  onDragEnd();
  if (!id) return;
  error.value = "";
  try {
    await projectsVM.assignGroup(id, groupId);
  } catch (e) {
    error.value = String(e);
  }
}

async function newGroup(): Promise<void> {
  const next = await askText(t("projects.newGroup"), "");
  if (!next?.trim()) return;
  error.value = "";
  try {
    await projectsVM.createGroup(next);
  } catch (e) {
    error.value = String(e);
  }
}

async function renameGroup(group: ProjectGroup): Promise<void> {
  const next = await askText(t("projects.renameGroupTitle"), group.name);
  if (!next?.trim() || next.trim() === group.name) return;
  error.value = "";
  try {
    await projectsVM.renameGroup(group.id, next);
  } catch (e) {
    error.value = String(e);
  }
}

async function removeGroup(group: ProjectGroup): Promise<void> {
  if (
    !(await askConfirm(
      t("projects.deleteGroupTitle"),
      t("projects.deleteGroupMessage", { name: group.name }),
    ))
  )
    return;
  error.value = "";
  try {
    await projectsVM.removeGroup(group.id);
  } catch (e) {
    error.value = String(e);
  }
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-2 rounded-xl bg-base-100 px-4 py-2.5">
      <input
        v-model="name"
        class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/40"
        :placeholder="t('projects.placeholder')"
        @keydown.enter="onCreateKey"
      />
      <button
        class="btn btn-sm shrink-0 rounded-lg border-0 bg-primary text-primary-content"
        @click="create"
      >
        {{ t("projects.create") }}
      </button>
    </div>

    <div class="flex items-center gap-2 px-1">
      <span class="text-[10.5px] text-base-content/35">{{ t("projects.groupsHint") }}</span>
      <button
        class="ml-auto text-[11.5px] text-base-content/45 hover:text-base-content"
        @click="newGroup"
      >
        + {{ t("projects.newGroup") }}
      </button>
    </div>

    <p v-if="error" class="px-1 text-[12px] text-error">{{ errorText(error) }}</p>

    <div class="space-y-2">
      <div
        v-for="section in sections"
        :key="section.id || 'ungrouped'"
        class="space-y-1.5 rounded-2xl transition-colors"
        :class="{
          'bg-primary/5 ring-1 ring-primary/25':
            section.group && dragOverGroupId === section.group.id,
        }"
        @dragenter.prevent="onGroupDragOver(section.group?.id ?? null, $event)"
        @dragover="onGroupDragOver(section.group?.id ?? null, $event)"
        @dragleave="onGroupDragLeave(section.group?.id ?? null, $event)"
        @drop="onGroupDrop(section.group?.id ?? null, $event)"
      >
        <div
          v-if="section.group || projectsVM.state.groups.length"
          class="flex items-center gap-2 px-1"
        >
          <span class="text-[10.5px] font-medium tracking-wide text-base-content/45">
            {{ section.name }}
          </span>
          <span class="text-[10.5px] text-base-content/30">
            {{ t("projects.groupCount", { count: section.projects.length }) }}
          </span>
          <span
            v-if="section.group && dragOverGroupId === section.group.id"
            class="text-[10.5px] text-primary"
          >
            {{ t("projects.dropHint") }}
          </span>
          <span
            v-else-if="!section.group && projectsVM.state.groups.length"
            class="text-[10.5px] text-base-content/30"
          >
            {{ t("projects.dragHint") }}
          </span>
          <template v-if="section.group">
            <button
              class="ml-auto text-[11px] text-base-content/35 hover:text-base-content"
              @click="renameGroup(section.group)"
            >
              {{ t("common.edit") }}
            </button>
            <button
              class="text-base-content/35 hover:text-error"
              :aria-label="t('projects.deleteGroupAria')"
              @click="removeGroup(section.group)"
            >
              <Trash :size="13" aria-hidden="true" />
            </button>
          </template>
        </div>

        <div
          v-if="section.group && draggingId && !section.projects.length"
          class="rounded-xl border border-dashed border-primary/25 px-4 py-3 text-center text-[11px] text-primary/60"
        >
          {{ t("projects.dropHint") }}
        </div>

        <AnimatePresence as="ul" mode="popLayout" :initial="false" class="space-y-1.5">
          <motion.li
            v-for="project in section.projects"
            :key="project.id"
            v-bind="listItemMotion"
            class="flex cursor-pointer items-center gap-3 rounded-xl bg-base-100 px-4 py-3 hover:opacity-90"
            :class="{ 'opacity-50': draggingId === project.id }"
            :draggable="canDrag(section)"
            :title="canDrag(section) ? t('projects.dragAria', { name: project.name }) : undefined"
            @dragstart="onDragStart(project, section, $event)"
            @dragend="onDragEnd"
            @click="router.push(`/projects/${project.id}`)"
          >
            <span
              v-if="canDrag(section)"
              class="cursor-grab text-base-content/25 active:cursor-grabbing"
              aria-hidden="true"
            >
              <GripVertical :size="13" />
            </span>
            <span class="text-[13.5px] font-medium">{{ project.name }}</span>
            <PriorityBadge :priority="project.priority" />
            <span class="ml-auto text-[11px] tabular-nums text-base-content/45">
              {{ project.done }}/{{ project.total }}
            </span>
            <button
              class="text-base-content/35"
              :aria-label="t('projects.settingsAria')"
              @click.stop="projectsVM.openSettings(project.id)"
            >
              <Ellipsis :size="14" aria-hidden="true" />
            </button>
          </motion.li>
        </AnimatePresence>
      </div>
    </div>

    <p
      v-if="!projectsVM.state.projects.length && !projectsVM.state.loading"
      class="px-1 text-[13px] text-base-content/40"
    >
      {{ t("projects.empty") }}
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

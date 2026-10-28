<script setup lang="ts">
import { X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { onMounted, reactive, ref } from "vue";
import { askText } from "../../lib/dialog";
import { errorText, t } from "../../lib/i18n";
import { backdropMotion, listItemMotion, modalPanelMotion } from "../../lib/motion";
import { isImeEnter } from "../../lib/keys";
import * as ipc from "../../model/ipc";
import type { Priority, ProjectGroup, ProjectMember } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { projectsVM } from "../../viewmodels/projectsVM";

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: [gone?: boolean] }>();

const form = reactive({
  name: "",
  groupId: "",
  priority: "normal" as Priority,
  members: [] as ProjectMember[],
});
const groups = ref<ProjectGroup[]>([]);
const memberName = ref("");
const error = ref("");

async function reload(): Promise<void> {
  const [project, list] = await Promise.all([ipc.getProject(props.id), ipc.listProjectGroups()]);
  form.name = project.name;
  form.groupId = project.groupId ?? "";
  form.priority = project.priority;
  form.members = project.members;
  groups.value = list;
}

/** Member edits are immediate, so refresh only the member list and keep unsaved fields. */
async function reloadMembers(): Promise<void> {
  form.members = (await ipc.getProject(props.id)).members;
}

onMounted(() => {
  void reload();
});

function memberNameOf(id: string): string {
  return appVM.state.people.find((p) => p.id === id)?.name ?? t("common.unknown");
}

async function save(): Promise<void> {
  error.value = "";
  try {
    await ipc.updateProject(props.id, form.name.trim(), form.groupId || null, form.priority);
    await projectsVM.load();
    emit("close");
  } catch (e) {
    error.value = String(e);
  }
}

function onPriorityChange(event: Event): void {
  form.priority = (event.target as HTMLSelectElement).value as Priority;
}

async function newGroup(): Promise<void> {
  const name = await askText(t("projects.newGroup"), "");
  if (!name?.trim()) return;
  error.value = "";
  try {
    const group = await projectsVM.createGroup(name);
    if (!group) return;
    groups.value = [...groups.value, group];
    form.groupId = group.id;
  } catch (e) {
    error.value = String(e);
  }
}

async function addMember(): Promise<void> {
  const name = memberName.value.trim();
  if (!name) return;
  error.value = "";
  try {
    await ipc.addMember(props.id, null, name);
    memberName.value = "";
    appVM.state.people = await ipc.listPeople();
    await reloadMembers();
  } catch (e) {
    error.value = String(e);
  }
}

function onMemberKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void addMember();
}

async function removeMember(personId: string): Promise<void> {
  const person = appVM.state.people.find((p) => p.id === personId);
  if (person?.isMe) return;
  error.value = "";
  try {
    await ipc.removeMember(props.id, personId);
    await reloadMembers();
  } catch (e) {
    error.value = String(e);
  }
}

/** The specialty owner takes over the tasks of that category in this project. */
async function onMemberCategory(personId: string, event: Event): Promise<void> {
  const categoryId = (event.target as HTMLSelectElement).value || null;
  error.value = "";
  try {
    const project = await ipc.setMemberCategory(props.id, personId, categoryId);
    form.members = project.members;
  } catch (e) {
    error.value = String(e);
  }
}

async function archive(): Promise<void> {
  error.value = "";
  try {
    await ipc.archiveProject(props.id);
    await projectsVM.load();
    emit("close", true);
  } catch (e) {
    error.value = String(e);
  }
}
</script>

<template>
  <motion.div
    v-bind="backdropMotion"
    class="fixed inset-0 z-40 flex items-center justify-center bg-neutral/40 p-4"
    @click.self="emit('close')"
  >
    <motion.div
      v-bind="modalPanelMotion"
      class="w-full max-w-[520px] rounded-2xl bg-base-100 p-5 shadow-2xl"
    >
      <div class="flex items-center">
        <h2 class="text-[15px] font-semibold">{{ t("projectSettings.title") }}</h2>
        <button
          class="ml-auto text-base-content/30"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <X :size="15" aria-hidden="true" />
        </button>
      </div>

      <p v-if="error" class="mt-2 text-[12px] text-error">{{ errorText(error) }}</p>

      <div class="mt-4 space-y-2 text-[12px]">
        <label class="flex items-center gap-3">
          <span class="w-16 shrink-0 text-base-content/50">{{ t("projectSettings.name") }}</span>
          <input v-model="form.name" class="input input-sm flex-1 rounded-lg border-base-300" />
        </label>
        <div class="flex items-center gap-3">
          <span class="w-16 shrink-0 text-base-content/50">{{ t("projectSettings.group") }}</span>
          <select
            v-model="form.groupId"
            class="select select-sm flex-1 rounded-lg border-base-300"
            :aria-label="t('projectSettings.group')"
          >
            <option value="">{{ t("projectSettings.noGroup") }}</option>
            <option v-for="group in groups" :key="group.id" :value="group.id">
              {{ group.name }}
            </option>
          </select>
          <button
            class="shrink-0 text-[11px] text-base-content/45 hover:text-base-content"
            @click="newGroup"
          >
            + {{ t("projects.newGroup") }}
          </button>
        </div>
        <label class="flex items-center gap-3">
          <span class="w-16 shrink-0 text-base-content/50">{{
            t("projectSettings.importance")
          }}</span>
          <select
            :value="form.priority"
            class="select select-sm flex-1 rounded-lg border-base-300"
            :aria-label="t('projectSettings.importance')"
            @change="onPriorityChange"
          >
            <option value="high">{{ t("task.priorityHigh") }}</option>
            <option value="normal">{{ t("task.priorityNormal") }}</option>
            <option value="low">{{ t("task.priorityLow") }}</option>
          </select>
        </label>
      </div>

      <div class="mt-4">
        <div class="flex items-baseline gap-2">
          <span class="text-[12px] font-medium">{{ t("projectSettings.members") }}</span>
          <span class="text-[10.5px] text-base-content/40">{{
            t("projectSettings.membersHint")
          }}</span>
        </div>
        <AnimatePresence
          as="div"
          mode="popLayout"
          :initial="false"
          class="mt-2 flex flex-wrap items-center gap-1.5"
        >
          <motion.span
            v-for="member in form.members"
            :key="member.personId"
            v-bind="listItemMotion"
            class="flex items-center gap-1.5 rounded-lg bg-base-200 px-2 py-1"
          >
            <span class="text-[12px]">{{ memberNameOf(member.personId) }}</span>
            <select
              class="select select-xs rounded-md border-base-300 bg-base-100 text-[11px]"
              :value="member.categoryId ?? ''"
              :aria-label="t('projectSettings.memberCategory')"
              @change="onMemberCategory(member.personId, $event)"
            >
              <option value="">{{ t("projectSettings.noCategory") }}</option>
              <option
                v-for="category in appVM.state.categories"
                :key="category.id"
                :value="category.id"
              >
                {{ category.name }}
              </option>
            </select>
            <button
              v-if="!appVM.state.people.find((p) => p.id === member.personId)?.isMe"
              class="text-base-content/30"
              :aria-label="t('projectSettings.removeMemberAria')"
              @click="removeMember(member.personId)"
            >
              <X :size="12" aria-hidden="true" />
            </button>
          </motion.span>
        </AnimatePresence>
        <div class="mt-2 flex items-center gap-2">
          <input
            v-model="memberName"
            class="input input-sm flex-1 rounded-lg border-dashed border-base-300"
            :placeholder="t('projectSettings.memberPlaceholder')"
            @keydown.enter="onMemberKey"
          />
          <button
            class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
            @click="addMember"
          >
            {{ t("projectSettings.addMember") }}
          </button>
        </div>
        <p class="mt-1.5 text-[10.5px] text-base-content/35">
          {{ t("projectSettings.membersNote") }}
        </p>
        <p class="mt-1 text-[10.5px] text-base-content/35">
          {{ t("projectSettings.memberCategoryHint") }}
        </p>
      </div>

      <div class="mt-5 flex items-center gap-2 border-t border-base-200 pt-3">
        <button
          class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
          @click="archive"
        >
          {{ t("projectSettings.archive") }}
        </button>
        <button
          class="btn btn-sm ml-auto rounded-lg border-base-300 bg-base-100 font-normal"
          @click="emit('close')"
        >
          {{ t("common.close") }}
        </button>
        <button
          class="btn btn-sm rounded-lg border-0 bg-primary text-primary-content"
          @click="save"
        >
          {{ t("common.save") }}
        </button>
      </div>
    </motion.div>
  </motion.div>
</template>

<script setup lang="ts">
import { X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { onMounted, reactive, ref } from "vue";
import { askConfirm } from "../../lib/dialog";
import { errorText, t } from "../../lib/i18n";
import { backdropMotion, listItemMotion, modalPanelMotion } from "../../lib/motion";
import { isImeEnter } from "../../lib/keys";
import * as ipc from "../../model/ipc";
import { appVM } from "../../viewmodels/appVM";
import { projectsVM } from "../../viewmodels/projectsVM";
import DateField from "../components/DateField.vue";

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: [gone?: boolean] }>();

const form = reactive({
  name: "",
  dueDate: "",
  memberIds: [] as string[],
});
const memberName = ref("");
const error = ref("");

async function reload(): Promise<void> {
  const project = await ipc.getProject(props.id);
  form.name = project.name;
  form.dueDate = project.dueDate ?? "";
  form.memberIds = project.memberIds;
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
    await ipc.updateProject(props.id, form.name.trim(), form.dueDate || null);
    await projectsVM.load();
    emit("close");
  } catch (e) {
    error.value = String(e);
  }
}

async function addMember(): Promise<void> {
  const name = memberName.value.trim();
  if (!name) return;
  await ipc.addMember(props.id, null, name);
  memberName.value = "";
  appVM.state.people = await ipc.listPeople();
  await reload();
}

function onMemberKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void addMember();
}

async function removeMember(personId: string): Promise<void> {
  const person = appVM.state.people.find((p) => p.id === personId);
  if (person?.isMe) return;
  await ipc.removeMember(props.id, personId);
  await reload();
}

async function archive(): Promise<void> {
  await ipc.archiveProject(props.id);
  await projectsVM.load();
  emit("close", true);
}

async function remove(): Promise<void> {
  if (!(await askConfirm(t("projectSettings.dialogTitle"), t("projectSettings.dialogMessage"))))
    return;
  await ipc.deleteProject(props.id);
  await projectsVM.load();
  emit("close", true);
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
        <label class="flex items-center gap-3">
          <span class="w-16 shrink-0 text-base-content/50">{{ t("projectSettings.due") }}</span>
          <DateField v-model="form.dueDate" class="input input-sm rounded-lg border-base-300" />
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
            v-for="personId in form.memberIds"
            :key="personId"
            v-bind="listItemMotion"
            class="badge badge-ghost badge-md gap-1.5"
          >
            {{ memberNameOf(personId) }}
            <button
              v-if="!appVM.state.people.find((p) => p.id === personId)?.isMe"
              class="text-base-content/30"
              :aria-label="t('projectSettings.removeMemberAria')"
              @click="removeMember(personId)"
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
      </div>

      <div class="mt-5 flex items-center gap-2 border-t border-base-200 pt-3">
        <button
          class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
          @click="archive"
        >
          {{ t("projectSettings.archive") }}
        </button>
        <button
          class="btn btn-sm rounded-lg border-error/25 bg-base-100 font-normal text-error"
          @click="remove"
        >
          {{ t("projectSettings.delete") }}
        </button>
        <button
          class="btn btn-sm ml-auto rounded-lg border-base-300 bg-base-100 font-normal"
          @click="emit('close')"
        >
          {{ t("common.cancel") }}
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

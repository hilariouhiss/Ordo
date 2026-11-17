<script setup lang="ts">
import { X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, reactive, ref } from "vue";
import { askNotice, askText } from "../../lib/dialog";
import { errorText, t } from "../../lib/i18n";
import { backdropMotion, listItemMotion, modalPanelMotion } from "../../lib/motion";
import { isImeEnter } from "../../lib/keys";
import { matchesName } from "../../lib/pinyin";
import * as ipc from "../../model/ipc";
import type { Priority, ProjectGroup, ProjectMember } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { projectsVM } from "../../viewmodels/projectsVM";
import { undoVM } from "../../viewmodels/undoVM";

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: [gone?: boolean] }>();

const form = reactive({
  name: "",
  groupId: "",
  priority: "normal" as Priority,
  members: [] as ProjectMember[],
  requirementPrefix: "REQ-",
  requirementWidth: 3,
  issuePrefix: "ISS-",
  issueWidth: 3,
});
const groups = ref<ProjectGroup[]>([]);
const memberName = ref("");
/** The add box lists the known people while it has focus. */
const peopleOpen = ref(false);
/** A line under the add box: the typed name was a person already in the ledger. */
const memberHint = ref("");
const error = ref("");

/** People this project does not have yet: what the add box and its picker can offer. */
const memberCandidates = computed(() =>
  appVM.state.people.filter(
    (person) => !form.members.some((member) => member.personId === person.id),
  ),
);
const memberMatches = computed(() =>
  memberCandidates.value.filter((person) => matchesName(person.name, memberName.value)),
);

async function reload(): Promise<void> {
  const [project, list] = await Promise.all([ipc.getProject(props.id), ipc.listProjectGroups()]);
  form.name = project.name;
  form.groupId = project.groupId ?? "";
  form.priority = project.priority;
  form.members = project.members;
  form.requirementPrefix = project.requirementPrefix;
  form.requirementWidth = project.requirementWidth;
  form.issuePrefix = project.issuePrefix;
  form.issueWidth = project.issueWidth;
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

/** Saving the project succeeded; a stale list is a different, non-fatal problem. */
async function refreshProjects(): Promise<void> {
  try {
    await projectsVM.load();
  } catch (e) {
    void askNotice(t("common.refreshFailed"), errorText(e));
  }
}

function validPrefix(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= 12 && !/\s/.test(trimmed);
}

function preview(prefix: string, width: number): string {
  const safe = Math.max(1, Math.min(6, Math.round(width) || 1));
  return prefix.trim() + String(1).padStart(safe, "0");
}

async function save(): Promise<void> {
  error.value = "";
  if (!validPrefix(form.requirementPrefix) || !validPrefix(form.issuePrefix)) {
    error.value = "invalid_number_prefix";
    return;
  }
  if (
    !(form.requirementWidth >= 1 && form.requirementWidth <= 6) ||
    !(form.issueWidth >= 1 && form.issueWidth <= 6)
  ) {
    error.value = "invalid_number_width";
    return;
  }
  try {
    await ipc.updateProject(props.id, form.name.trim(), form.groupId || null, form.priority, {
      requirementPrefix: form.requirementPrefix.trim(),
      requirementWidth: Math.round(form.requirementWidth),
      issuePrefix: form.issuePrefix.trim(),
      issueWidth: Math.round(form.issueWidth),
    });
  } catch (e) {
    error.value = String(e);
    return;
  }
  await refreshProjects();
  emit("close");
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

/** Adds a picked person by id, or the typed name; the backend reuses a person it already knows. */
async function addMember(personId: string | null = null): Promise<void> {
  const name = memberName.value.trim();
  if (!personId && !name) return;
  error.value = "";
  memberHint.value = "";
  let id = personId;
  let reused = false;
  if (!id) {
    const known = appVM.state.people.find((person) => person.name === name);
    // A typed name the ledger already knows reuses that person: say which, do not stay silent.
    if (known && form.members.some((member) => member.personId === known.id)) {
      memberName.value = "";
      peopleOpen.value = false;
      memberHint.value = t("projectSettings.memberAlready", { name });
      return;
    }
    if (known) {
      id = known.id;
      reused = true;
    }
  }
  try {
    await ipc.addMember(props.id, id, id ? null : name);
    memberName.value = "";
    peopleOpen.value = false;
    if (reused) memberHint.value = t("projectSettings.memberReused", { name });
  } catch (e) {
    memberHint.value = "";
    error.value = String(e);
    return;
  }
  try {
    appVM.state.people = await ipc.listPeople();
    await reloadMembers();
  } catch (e) {
    void askNotice(t("common.refreshFailed"), errorText(e));
  }
}

function onMemberKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void addMember();
}

/** Typing reopens the list and drops any earlier hint. */
function onMemberInput(): void {
  peopleOpen.value = true;
  memberHint.value = "";
}

async function removeMember(personId: string): Promise<void> {
  const person = appVM.state.people.find((p) => p.id === personId);
  if (person?.isMe) return;
  error.value = "";
  try {
    await ipc.removeMember(props.id, personId);
  } catch (e) {
    error.value = String(e);
    return;
  }
  try {
    await reloadMembers();
  } catch (e) {
    void askNotice(t("common.refreshFailed"), errorText(e));
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
  } catch (e) {
    error.value = String(e);
    return;
  }
  undoVM.pushUndo(t("undo.archivedProject", { name: form.name }), async () => {
    await ipc.restoreProject(props.id);
  });
  await refreshProjects();
  emit("close", true);
}
</script>

<template>
  <motion.div
    v-bind="backdropMotion"
    class="window-scrim fixed inset-0 z-40 flex items-center justify-center bg-neutral/40 p-4"
    @click.self="emit('close')"
  >
    <motion.div
      v-bind="modalPanelMotion"
      class="flex max-h-[86vh] w-full max-w-[520px] flex-col overflow-hidden rounded-2xl bg-base-100 shadow-2xl"
    >
      <div class="flex shrink-0 items-center px-5 pt-5">
        <h2 class="text-[15px] font-semibold">{{ t("projectSettings.title") }}</h2>
        <button
          class="ml-auto text-base-content/30"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <X :size="15" aria-hidden="true" />
        </button>
      </div>

      <div class="min-h-0 overflow-y-auto px-5 pb-5">
        <p v-if="error" class="mt-2 text-[12px] text-error">{{ errorText(error) }}</p>

        <div class="mt-4 space-y-2 text-[12px]">
          <label class="flex items-center gap-3">
            <span class="w-16 shrink-0 text-base-content/65">{{ t("projectSettings.name") }}</span>
            <input v-model="form.name" class="input input-sm flex-1 rounded-lg border-base-300" />
          </label>
          <div class="flex items-center gap-3">
            <span class="w-16 shrink-0 text-base-content/65">{{ t("projectSettings.group") }}</span>
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
              class="shrink-0 text-[12px] text-base-content/65 hover:text-base-content"
              @click="newGroup"
            >
              + {{ t("projects.newGroup") }}
            </button>
          </div>
          <label class="flex items-center gap-3">
            <span class="w-16 shrink-0 text-base-content/65">{{
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
            <span class="text-[12px] font-medium">{{ t("projectSettings.numbering") }}</span>
            <span class="text-[12px] text-base-content/60">{{
              t("projectSettings.numberingHint")
            }}</span>
          </div>
          <div class="mt-2 space-y-1.5 text-[12px]">
            <div class="flex items-center gap-2">
              <span class="w-16 shrink-0 text-base-content/65">{{
                t("projectSettings.numberingRequirement")
              }}</span>
              <span class="text-base-content/50">{{ t("projectSettings.numberingPrefix") }}</span>
              <input
                v-model="form.requirementPrefix"
                maxlength="12"
                class="input input-xs w-20 rounded-md border-base-300 font-mono"
                :aria-label="t('projectSettings.numberingPrefix')"
              />
              <span class="text-base-content/50">{{ t("projectSettings.numberingWidth") }}</span>
              <input
                v-model.number="form.requirementWidth"
                type="number"
                min="1"
                max="6"
                class="input input-xs w-14 rounded-md border-base-300 text-center font-mono"
                :aria-label="t('projectSettings.numberingWidth')"
              />
              <span
                class="ml-auto rounded-md bg-base-200 px-2 py-0.5 font-mono text-[11px] text-base-content/60"
                >{{ preview(form.requirementPrefix, form.requirementWidth) }}</span
              >
            </div>
            <div class="flex items-center gap-2">
              <span class="w-16 shrink-0 text-base-content/65">{{
                t("projectSettings.numberingIssue")
              }}</span>
              <span class="text-base-content/50">{{ t("projectSettings.numberingPrefix") }}</span>
              <input
                v-model="form.issuePrefix"
                maxlength="12"
                class="input input-xs w-20 rounded-md border-base-300 font-mono"
                :aria-label="t('projectSettings.numberingPrefix')"
              />
              <span class="text-base-content/50">{{ t("projectSettings.numberingWidth") }}</span>
              <input
                v-model.number="form.issueWidth"
                type="number"
                min="1"
                max="6"
                class="input input-xs w-14 rounded-md border-base-300 text-center font-mono"
                :aria-label="t('projectSettings.numberingWidth')"
              />
              <span
                class="ml-auto rounded-md bg-base-200 px-2 py-0.5 font-mono text-[11px] text-base-content/60"
                >{{ preview(form.issuePrefix, form.issueWidth) }}</span
              >
            </div>
            <p class="text-[11px] leading-5 text-base-content/50">
              {{ t("projectSettings.numberingNote") }}
            </p>
          </div>
        </div>

        <div class="mt-4">
          <div class="flex items-baseline gap-2">
            <span class="text-[12px] font-medium">{{ t("projectSettings.members") }}</span>
            <span class="text-[12px] text-base-content/60">{{
              t("projectSettings.membersHint")
            }}</span>
          </div>
          <AnimatePresence
            as="div"
            mode="popLayout"
            :initial="false"
            class="mt-2 grid grid-cols-3 gap-1.5"
          >
            <motion.span
              v-for="member in form.members"
              :key="member.personId"
              v-bind="listItemMotion"
              class="flex min-w-0 items-center gap-1.5 rounded-lg bg-base-200 px-2 py-1"
            >
              <!-- The name holds its column; daisyUI's select wants 100% and would squash it. -->
              <span
                class="w-12 shrink-0 truncate text-[12px]"
                :title="memberNameOf(member.personId)"
                >{{ memberNameOf(member.personId) }}</span
              >
              <select
                class="select select-xs min-w-0 flex-1 rounded-md border-base-300 bg-base-100 text-[12px]"
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
                class="shrink-0 text-base-content/30"
                :aria-label="t('projectSettings.removeMemberAria')"
                @click="removeMember(member.personId)"
              >
                <X :size="12" aria-hidden="true" />
              </button>
            </motion.span>
          </AnimatePresence>
          <div class="relative mt-2 min-w-0">
            <input
              v-model="memberName"
              class="input input-sm w-full rounded-lg border-dashed border-base-300"
              :placeholder="t('projectSettings.memberPlaceholder')"
              @focus="peopleOpen = true"
              @input="onMemberInput"
              @blur="peopleOpen = false"
              @keydown.enter="onMemberKey"
            />
            <!-- Focus offers the people still missing here; a click adds that one. -->
            <div
              v-if="peopleOpen && memberMatches.length"
              class="absolute inset-x-0 bottom-full z-10 mb-1 max-h-44 overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-1 shadow-xl"
            >
              <button
                v-for="person in memberMatches"
                :key="person.id"
                type="button"
                class="block w-full rounded-md px-2 py-1 text-left text-[12px] text-base-content/70 hover:bg-base-200"
                @mousedown.prevent
                @click="addMember(person.id)"
              >
                {{ person.name }}
              </button>
            </div>
          </div>
          <p v-if="memberHint" class="mt-1.5 text-[12px] text-primary">{{ memberHint }}</p>
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
            class="btn btn-sm rounded-lg border-0 bg-base-content text-base-100"
            @click="save"
          >
            {{ t("common.save") }}
          </button>
        </div>
      </div>
    </motion.div>
  </motion.div>
</template>

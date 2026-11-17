<script setup lang="ts">
import { Pencil, Plus, X } from "@lucide/vue";
import { computed, nextTick, reactive, ref, watch } from "vue";
import { askConfirm } from "../../lib/dialog";
import { errorText, t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import type { Issue, IssueStatus, Requirement, Task } from "../../model/types";
import { issuesVM } from "../../viewmodels/issuesVM";
import { taskSheetVM } from "../../viewmodels/taskSheetVM";
import ChipSelect from "../components/ChipSelect.vue";
import LinkPicker from "../components/LinkPicker.vue";

const props = defineProps<{ projectId: string; tasks: Task[]; requirements: Requirement[] }>();
const emit = defineEmits<{ changed: []; "focus-requirement": [id: string] }>();

const NONE = "";
const expanded = reactive<Record<string, boolean>>({});
const renamingId = ref<string | null>(null);
const renameDraft = ref("");
const newTitle = ref("");
const notes = reactive<Record<string, string>>({});
const taskDrafts = reactive<Record<string, string>>({});
const picker = ref<string | null>(null);

const issues = computed(() => issuesVM.state.issues);
const issueStatuses: IssueStatus[] = ["open", "doing", "resolved"];

function statusLabel(status: IssueStatus): string {
  return status === "resolved"
    ? t("issues.status.resolved")
    : status === "doing"
      ? t("issues.status.doing")
      : t("issues.status.open");
}
function statusClass(status: IssueStatus): string {
  if (status === "resolved") return "bg-success/15 text-success";
  if (status === "doing") return "bg-warning/15 text-warning";
  return "bg-base-200 text-base-content/65";
}
function toggle(issue: Issue): void {
  expanded[issue.id] = !expanded[issue.id];
}
function requirementOf(issue: Issue): Requirement | null {
  return props.requirements.find((requirement) => requirement.id === issue.requirementId) ?? null;
}
function requirementName(issue: Issue): string {
  const requirement = requirementOf(issue);
  return requirement ? `${requirement.number} ${requirement.title}` : "";
}
const requirementOptions = computed(() => [
  { value: NONE, label: t("issues.noRequirement") },
  ...props.requirements.map((requirement) => ({
    value: requirement.id,
    label: `${requirement.number} ${requirement.title}`,
  })),
]);

async function add(): Promise<void> {
  if (await issuesVM.add(props.projectId, newTitle.value)) newTitle.value = "";
}
function onAddKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void add();
}
function startRename(issue: Issue): void {
  renamingId.value = issue.id;
  renameDraft.value = issue.title;
}
function cancelRename(): void {
  renamingId.value = null;
  renameDraft.value = "";
}
async function commitRename(issue: Issue): Promise<void> {
  if (renamingId.value !== issue.id) return;
  const title = renameDraft.value.trim();
  cancelRename();
  if (!title || title === issue.title) return;
  if (await issuesVM.update(issue.id, { title })) emit("changed");
}
function onRenameKey(event: KeyboardEvent, issue: Issue): void {
  if (event.key === "Escape") {
    cancelRename();
    return;
  }
  if (isImeEnter(event)) return;
  void commitRename(issue);
}
async function remove(issue: Issue): Promise<void> {
  if (
    !(await askConfirm(t("issues.removeTitle"), t("issues.removeMessage", { title: issue.title })))
  ) {
    return;
  }
  if (await issuesVM.remove(issue.id)) emit("changed");
}
async function setStatus(issue: Issue, status: IssueStatus): Promise<void> {
  if (status === issue.status) return;
  if (await issuesVM.update(issue.id, { status })) emit("changed");
}
async function setRequirement(issue: Issue, value: string): Promise<void> {
  if (await issuesVM.update(issue.id, { requirementId: value || null })) emit("changed");
}
function noteOf(issue: Issue): string {
  return notes[issue.id] ?? issue.note ?? "";
}
function onNoteInput(issue: Issue, event: Event): void {
  notes[issue.id] = (event.target as HTMLTextAreaElement).value;
}
async function saveNote(issue: Issue): Promise<void> {
  const value = noteOf(issue);
  if (value.trim() === (issue.note ?? "").trim()) {
    delete notes[issue.id];
    return;
  }
  if (await issuesVM.update(issue.id, { note: value.trim() || null })) {
    delete notes[issue.id];
    emit("changed");
  }
}
async function createTask(issue: Issue): Promise<void> {
  const draft = (taskDrafts[issue.id] ?? "").trim();
  if (!draft) return;
  if (await issuesVM.createTask(issue.id, draft)) {
    delete taskDrafts[issue.id];
    emit("changed");
  }
}
function onTaskKey(event: KeyboardEvent, issue: Issue): void {
  if (isImeEnter(event)) return;
  void createTask(issue);
}
async function toggleTask(issue: Issue, taskId: string): Promise<void> {
  const linked = issue.tasks.some((task) => task.id === taskId);
  const ok = linked ? await issuesVM.unlinkTask(taskId) : await issuesVM.linkTask(taskId, issue.id);
  if (ok) emit("changed");
}
function taskOptions(issue: Issue): { value: string; label: string }[] {
  return props.tasks
    .filter((task) => !task.issueId || task.issueId === issue.id)
    .map((task) => ({ value: task.id, label: task.title }));
}
function taskChecked(issue: Issue): string[] {
  return issue.tasks
    .map((task) => task.id)
    .filter((id) => props.tasks.some((task) => task.id === id));
}
function openTask(id: string): void {
  void taskSheetVM.open(id);
}
function openRequirement(id: string): void {
  emit("focus-requirement", id);
}
function createdDate(issue: Issue): string {
  const date = new Date(issue.createdAt);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

watch(
  () => issuesVM.state.focusIssueId,
  async (id) => {
    if (!id) return;
    expanded[id] = true;
    await nextTick();
    document.getElementById(`issue-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
    issuesVM.state.focusIssueId = null;
  },
  { immediate: true },
);
</script>

<template>
  <section class="space-y-2">
    <div class="rounded-xl bg-base-100 px-3 py-2">
      <div class="flex items-center gap-2 border-b border-base-200 pb-1.5">
        <span class="text-[12px] font-semibold">{{ t("issues.title") }}</span>
        <span class="text-[11px] text-base-content/45">{{ t("issues.hint") }}</span>
      </div>
      <p v-if="issuesVM.state.error" class="mt-1.5 text-[12px] text-error">
        {{ errorText(issuesVM.state.error) }}
      </p>
      <ul v-if="issues.length" class="mt-0.5">
        <li
          v-for="issue in issues"
          :id="`issue-${issue.id}`"
          :key="issue.id"
          class="border-t border-base-200 py-2 first:border-t-0"
        >
          <div class="flex items-center gap-2 text-[12.5px]">
            <span
              class="shrink-0 rounded-md px-1.5 py-0.5 text-[11px]"
              :class="statusClass(issue.status)"
            >
              {{ statusLabel(issue.status) }}
            </span>
            <span class="shrink-0 font-mono text-[11px] text-base-content/50">{{
              issue.number
            }}</span>
            <button
              v-if="renamingId !== issue.id"
              type="button"
              class="min-w-0 flex-1 truncate text-left font-medium"
              :class="{ 'text-base-content/50 line-through': issue.status === 'resolved' }"
              @click="toggle(issue)"
            >
              {{ issue.title }}
            </button>
            <input
              v-else
              v-model="renameDraft"
              class="min-w-0 flex-1 rounded-md border border-base-300 bg-base-100 px-1.5 py-0.5 text-[12.5px] outline-none focus:border-primary/60"
              :aria-label="t('issues.renameAria', { title: issue.title })"
              @blur="commitRename(issue)"
              @keydown="onRenameKey($event, issue)"
            />
            <button
              v-if="requirementOf(issue)"
              type="button"
              class="shrink-0 max-w-52 truncate text-[11px] text-primary"
              @click="openRequirement(requirementOf(issue)?.id ?? '')"
            >
              {{ requirementName(issue) }}
            </button>
            <span class="ml-auto shrink-0 text-[11px] tabular-nums text-base-content/40">
              {{ issue.tasks.length ? `${t("issues.tasks")} ${issue.tasks.length}` : "" }}
              {{ createdDate(issue) }}
            </span>
            <button
              type="button"
              class="shrink-0 text-base-content/30 hover:text-base-content"
              :aria-label="t('issues.renameAria', { title: issue.title })"
              @click="startRename(issue)"
            >
              <Pencil :size="11" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="shrink-0 text-base-content/30 hover:text-error"
              :aria-label="t('issues.removeAria', { title: issue.title })"
              @click="remove(issue)"
            >
              <X :size="12" aria-hidden="true" />
            </button>
          </div>

          <div v-if="expanded[issue.id]" class="mt-2 space-y-2 pl-3.5">
            <div class="flex flex-wrap items-center gap-1.5 text-[12px]">
              <span class="mr-0.5 text-base-content/65">{{ t("issues.status.open") }}</span>
              <button
                v-for="status in issueStatuses"
                :key="status"
                type="button"
                class="rounded-md border px-2 py-0.5 text-[11.5px]"
                :class="
                  issue.status === status
                    ? 'border-base-content/25 bg-base-300 font-medium text-base-content'
                    : 'border-base-300 text-base-content/65 hover:text-base-content'
                "
                :aria-pressed="issue.status === status"
                @click="setStatus(issue, status)"
              >
                {{ statusLabel(status) }}
              </button>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-[12px] text-base-content/65">
              <span>{{ t("issues.requirement") }}</span>
              <ChipSelect
                :model-value="issue.requirementId ?? NONE"
                :options="requirementOptions"
                :label="t('issues.requirement')"
                class="select-xs min-w-40 rounded-md border-base-300"
                @update:model-value="setRequirement(issue, $event)"
              />
            </div>
            <textarea
              :value="noteOf(issue)"
              rows="2"
              class="w-full resize-none rounded-md border border-base-300 bg-base-100 px-2 py-1.5 text-[12px] leading-5 outline-none placeholder:text-base-content/40 focus:border-primary/60"
              :placeholder="t('issues.notePlaceholder')"
              :aria-label="t('issues.notePlaceholder')"
              @input="onNoteInput(issue, $event)"
              @blur="saveNote(issue)"
            ></textarea>
            <div class="relative flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span class="w-8 shrink-0 text-base-content/45">{{ t("issues.tasks") }}</span>
              <span
                v-for="task in issue.tasks"
                :key="task.id"
                class="flex items-center gap-1 rounded-md border border-base-300 px-1.5 py-0.5"
              >
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  :class="
                    task.status === 'done'
                      ? 'bg-success'
                      : task.status === 'doing'
                        ? 'bg-warning'
                        : 'bg-base-content/25'
                  "
                ></span>
                <button
                  type="button"
                  class="max-w-56 truncate hover:text-primary"
                  @click="openTask(task.id)"
                >
                  {{ task.title }}
                </button>
                <button
                  type="button"
                  class="text-base-content/30 hover:text-error"
                  :aria-label="t('issues.removeAria', { title: task.title })"
                  @click="toggleTask(issue, task.id)"
                >
                  <X :size="10" aria-hidden="true" />
                </button>
              </span>
              <button
                type="button"
                class="px-1 text-[13px] text-base-content/50 hover:text-base-content"
                :aria-label="t('issues.linkTask')"
                @click="picker = picker === issue.id ? null : issue.id"
              >
                +
              </button>
              <LinkPicker
                v-if="picker === issue.id"
                :options="taskOptions(issue)"
                :checked="taskChecked(issue)"
                @toggle="toggleTask(issue, $event)"
                @close="picker = null"
              />
            </div>
            <div class="flex items-center gap-2 text-[12px]">
              <Plus :size="11" class="shrink-0 text-base-content/45" aria-hidden="true" />
              <input
                v-model="taskDrafts[issue.id]"
                class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-base-content/40"
                :placeholder="t('issues.newTaskPlaceholder')"
                @keydown.enter="onTaskKey($event, issue)"
              />
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="mt-2 text-[12px] text-base-content/50">{{ t("issues.empty") }}</p>
      <div class="mt-2 flex items-center gap-2 border-t border-base-200 pt-2 text-[12.5px]">
        <Plus :size="11" class="shrink-0 text-base-content/60" aria-hidden="true" />
        <input
          v-model="newTitle"
          class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-base-content/45"
          :placeholder="t('issues.addPlaceholder')"
          :aria-label="t('issues.addAria')"
          @keydown.enter="onAddKey"
        />
        <button
          type="button"
          class="btn btn-xs shrink-0 rounded-md border-0 bg-base-content font-medium text-base-100"
          @click="add"
        >
          {{ t("requirements.add") }}
        </button>
      </div>
    </div>
  </section>
</template>

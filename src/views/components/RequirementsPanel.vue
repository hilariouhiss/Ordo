<script setup lang="ts">
import { ChevronRight, Pencil, Plus, X } from "@lucide/vue";
import { computed, nextTick, reactive, ref, watch } from "vue";
import { askConfirm } from "../../lib/dialog";
import { errorText, t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import type { Requirement, RequirementChange, Task } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { issuesVM } from "../../viewmodels/issuesVM";
import { requirementsVM } from "../../viewmodels/requirementsVM";
import { taskSheetVM } from "../../viewmodels/taskSheetVM";
import ChipSelect from "../components/ChipSelect.vue";
import LinkPicker from "../components/LinkPicker.vue";
import StatusPipeline from "../overlays/StatusPipeline.vue";
import DocumentSheet from "../overlays/DocumentSheet.vue";

const props = defineProps<{ projectId: string; tasks: Task[] }>();
const emit = defineEmits<{ changed: []; "focus-issue": [id: string] }>();

const expanded = reactive<Record<string, boolean>>({});
const renamingId = ref<string | null>(null);
const renameDraft = ref("");
const newTitle = ref("");
const taskDrafts = reactive<Record<string, string>>({});
const picker = ref<{ requirementId: string; kind: "chapter" | "task" } | null>(null);
const statusOpen = ref(false);
const uploadInput = ref<HTMLInputElement | null>(null);

const NONE = "";
const requirements = computed(() => requirementsVM.state.requirements);
const documents = computed(() => requirementsVM.state.documents);
const statuses = computed(() => requirementsVM.state.statuses);

function statusName(requirement: Requirement): string {
  return requirementsVM.statusOf(requirement)?.name ?? t("common.none");
}
function statusTone(requirement: Requirement): string {
  const index = statuses.value.findIndex((status) => status.id === requirement.statusId);
  if (index < 0) return "bg-base-300";
  if (statuses.value.length <= 1) return "bg-primary";
  if (index === statuses.value.length - 1) return "bg-success";
  if (index === 0) return "bg-base-content/25";
  return "bg-warning";
}
function nextStatus(requirement: Requirement) {
  return requirementsVM.nextStatus(requirement);
}
function toggle(requirement: Requirement): void {
  expanded[requirement.id] = !expanded[requirement.id];
}
function categoryName(requirement: Requirement): string {
  if (!requirement.categoryId) return t("common.uncategorized");
  return (
    appVM.state.categories.find((category) => category.id === requirement.categoryId)?.name ??
    t("common.uncategorized")
  );
}
function ownerName(requirement: Requirement): string {
  if (!requirement.ownerId) return t("requirements.unassigned");
  return (
    appVM.state.people.find((person) => person.id === requirement.ownerId)?.name ??
    t("requirements.unassigned")
  );
}
function doneCount(requirement: Requirement): number {
  return requirement.tasks.filter((task) => task.status === "done").length;
}
function quoteOf(requirement: Requirement): string | null {
  return requirement.sections.find((section) => section.quote)?.quote ?? null;
}
function statusLabel(status: string): string {
  return status === "done"
    ? t("task.statusDone")
    : status === "doing"
      ? t("task.statusDoing")
      : t("task.statusTodo");
}

async function add(): Promise<void> {
  if (await requirementsVM.add(props.projectId, newTitle.value)) newTitle.value = "";
}
function onAddKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void add();
}

function startRename(requirement: Requirement): void {
  renamingId.value = requirement.id;
  renameDraft.value = requirement.title;
}
function cancelRename(): void {
  renamingId.value = null;
  renameDraft.value = "";
}
async function commitRename(requirement: Requirement): Promise<void> {
  if (renamingId.value !== requirement.id) return;
  const title = renameDraft.value.trim();
  cancelRename();
  if (!title || title === requirement.title) return;
  await requirementsVM.update(requirement.id, { title });
}
function onRenameKey(event: KeyboardEvent, requirement: Requirement): void {
  if (event.key === "Escape") {
    cancelRename();
    return;
  }
  if (isImeEnter(event)) return;
  void commitRename(requirement);
}
async function remove(requirement: Requirement): Promise<void> {
  if (
    !(await askConfirm(
      t("requirements.removeTitle"),
      t("requirements.removeMessage", { title: requirement.title }),
    ))
  ) {
    return;
  }
  if (await requirementsVM.remove(requirement.id)) emit("changed");
}
async function advance(requirement: Requirement): Promise<void> {
  await requirementsVM.advance(requirement.id);
}
async function setCategory(requirement: Requirement, value: string): Promise<void> {
  await requirementsVM.update(requirement.id, { categoryId: value || null });
}
async function setOwner(requirement: Requirement, value: string): Promise<void> {
  await requirementsVM.update(requirement.id, { ownerId: value || null });
}
async function createTask(requirement: Requirement): Promise<void> {
  const draft = (taskDrafts[requirement.id] ?? "").trim();
  if (!draft) return;
  if (await requirementsVM.createTask(requirement.id, draft)) {
    delete taskDrafts[requirement.id];
    emit("changed");
  }
}
function onTaskKey(event: KeyboardEvent, requirement: Requirement): void {
  if (isImeEnter(event)) return;
  void createTask(requirement);
}
async function toggleTask(requirement: Requirement, taskId: string): Promise<void> {
  const linked = requirement.tasks.some((task) => task.id === taskId);
  const ok = linked
    ? await requirementsVM.unlinkTask(taskId)
    : await requirementsVM.linkTask(requirement.id, taskId);
  if (ok) emit("changed");
}
async function toggleChapter(requirement: Requirement, sectionId: string): Promise<void> {
  const linked = requirement.sections.some((section) => section.sectionId === sectionId);
  if (linked) await requirementsVM.unlinkSection(requirement.id, sectionId);
  else await requirementsVM.linkSection(requirement.id, sectionId);
}
async function unlinkIssue(issueId: string): Promise<void> {
  if (await issuesVM.update(issueId, { requirementId: null })) emit("changed");
}
function openTask(id: string): void {
  void taskSheetVM.open(id);
}

const categoryOptions = computed(() => [
  { value: NONE, label: t("common.uncategorized") },
  ...appVM.state.categories.map((category) => ({ value: category.id, label: category.name })),
]);
const ownerOptions = computed(() => [
  { value: NONE, label: t("requirements.unassigned") },
  ...appVM.state.people.map((person) => ({ value: person.id, label: person.name })),
]);
function chapterOptions(): { value: string; label: string }[] {
  return documents.value.flatMap((document) =>
    document.sections.map((section) => ({
      value: section.id,
      label: `${document.title} · ${section.title}`,
    })),
  );
}
function chapterChecked(requirement: Requirement): string[] {
  return requirement.sections.map((section) => section.sectionId);
}
function taskOptions(requirement: Requirement): { value: string; label: string }[] {
  return props.tasks
    .filter((task) => !task.requirementId || task.requirementId === requirement.id)
    .map((task) => ({ value: task.id, label: `${task.title} · ${statusLabel(task.status)}` }));
}
function taskChecked(requirement: Requirement): string[] {
  return requirement.tasks
    .map((task) => task.id)
    .filter((id) => props.tasks.some((task) => task.id === id));
}

async function openDocument(id: string): Promise<void> {
  await requirementsVM.openDocument(id);
}
function openUpload(): void {
  uploadInput.value?.click();
}
async function onFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  await requirementsVM.upload(props.projectId, file);
}

function history(requirement: Requirement): RequirementChange[] {
  return requirementsVM.state.changesFor === requirement.id ? requirementsVM.state.changes : [];
}
function historyOpen(requirement: Requirement): boolean {
  return requirementsVM.state.changesFor === requirement.id;
}
function toggleHistory(requirement: Requirement): void {
  void requirementsVM.loadChanges(requirement.id);
}
function historyText(change: RequirementChange): string {
  const from = change.fromValue ?? t("common.none");
  const to = change.toValue ?? t("common.none");
  switch (change.kind) {
    case "created":
      return t("requirements.history.created", { to });
    case "title":
      return t("requirements.history.title", { from, to });
    case "category":
      return t("requirements.history.category", { from, to });
    case "owner":
      return t("requirements.history.owner", { from, to });
    case "status":
      return t("requirements.history.status", { from, to });
    case "status_auto":
      return t("requirements.history.statusAuto", { from, to });
    case "section_linked":
      return t("requirements.history.sectionLinked", { to });
    case "section_unlinked":
      return t("requirements.history.sectionUnlinked", { from });
    case "task_linked":
      return t("requirements.history.taskLinked", { to });
    case "task_unlinked":
      return t("requirements.history.taskUnlinked", { from });
    case "task_created":
      return t("requirements.history.taskCreated", { to });
    case "issue_linked":
      return t("requirements.history.issueLinked", { to });
    case "issue_unlinked":
      return t("requirements.history.issueUnlinked", { from });
    default:
      return change.kind;
  }
}
function changeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

watch(
  () => requirementsVM.state.focusRequirementId,
  async (id) => {
    if (!id) return;
    expanded[id] = true;
    await nextTick();
    document.getElementById(`requirement-${id}`)?.scrollIntoView({
      block: "center",
      behavior: "smooth",
    });
    requirementsVM.state.focusRequirementId = null;
  },
  { immediate: true },
);
</script>

<template>
  <section class="space-y-2">
    <div class="rounded-xl bg-base-100 px-3 py-2">
      <div class="flex items-center gap-2 border-b border-base-200 pb-1.5">
        <span class="text-[12px] font-semibold">{{ t("requirements.title") }}</span>
        <span class="text-[11px] text-base-content/45">{{ t("requirements.hint") }}</span>
        <button
          type="button"
          class="ml-auto text-[12px] text-base-content/60 hover:text-base-content"
          @click="statusOpen = true"
        >
          {{ t("requirements.statusFlow") }}
        </button>
      </div>
      <p v-if="requirementsVM.state.error" class="mt-1.5 text-[12px] text-error">
        {{ errorText(requirementsVM.state.error) }}
      </p>
      <ul v-if="requirements.length" class="mt-0.5">
        <li
          v-for="requirement in requirements"
          :id="`requirement-${requirement.id}`"
          :key="requirement.id"
          class="border-t border-base-200 py-2 first:border-t-0"
        >
          <div class="flex items-center gap-2 text-[12.5px]">
            <span class="h-1.5 w-1.5 shrink-0 rounded-full" :class="statusTone(requirement)"></span>
            <span class="shrink-0 font-mono text-[11px] text-base-content/50">{{
              requirement.number
            }}</span>
            <button
              v-if="renamingId !== requirement.id"
              type="button"
              class="min-w-0 flex-1 truncate text-left font-medium"
              @click="toggle(requirement)"
            >
              {{ requirement.title }}
            </button>
            <input
              v-else
              v-model="renameDraft"
              class="min-w-0 flex-1 rounded-md border border-base-300 bg-base-100 px-1.5 py-0.5 text-[12.5px] outline-none focus:border-primary/60"
              :aria-label="t('requirements.renameAria', { title: requirement.title })"
              @blur="commitRename(requirement)"
              @keydown="onRenameKey($event, requirement)"
            />
            <span class="shrink-0 text-[11px] text-base-content/55">{{
              categoryName(requirement)
            }}</span>
            <span class="shrink-0 text-[11px] text-base-content/55">{{
              ownerName(requirement)
            }}</span>
            <span class="shrink-0 rounded-md bg-base-200 px-1.5 py-0.5 text-[11px]">{{
              statusName(requirement)
            }}</span>
            <button
              v-if="nextStatus(requirement)"
              type="button"
              class="shrink-0 rounded-md border border-dashed border-base-300 px-1.5 py-0.5 text-[11px] text-primary"
              :aria-label="
                t('requirements.advanceAria', {
                  title: requirement.title,
                  status: nextStatus(requirement)?.name ?? '',
                })
              "
              @click="advance(requirement)"
            >
              {{ t("requirements.advance", { status: nextStatus(requirement)?.name ?? "" }) }}
            </button>
            <span class="ml-auto shrink-0 text-[11px] tabular-nums text-base-content/40">
              {{ t("requirements.tasks") }} {{ doneCount(requirement) }}/{{
                requirement.tasks.length
              }}
              · {{ t("requirements.chapters") }} {{ requirement.sections.length }}
            </span>
            <button
              type="button"
              class="shrink-0 text-base-content/30 hover:text-base-content"
              :aria-label="t('requirements.renameAria', { title: requirement.title })"
              @click="startRename(requirement)"
            >
              <Pencil :size="11" aria-hidden="true" />
            </button>
            <button
              type="button"
              class="shrink-0 text-base-content/30 hover:text-error"
              :aria-label="t('requirements.removeAria', { title: requirement.title })"
              @click="remove(requirement)"
            >
              <X :size="12" aria-hidden="true" />
            </button>
          </div>

          <div v-if="expanded[requirement.id]" class="mt-2 space-y-2 pl-3.5">
            <div class="flex flex-wrap items-center gap-2 text-[12px] text-base-content/65">
              <span>{{ t("requirements.category") }}</span>
              <ChipSelect
                :model-value="requirement.categoryId ?? NONE"
                :options="categoryOptions"
                :label="t('requirements.category')"
                class="select-xs min-w-24 rounded-md border-base-300"
                @update:model-value="setCategory(requirement, $event)"
              />
              <span class="ml-2">{{ t("requirements.owner") }}</span>
              <ChipSelect
                :model-value="requirement.ownerId ?? NONE"
                :options="ownerOptions"
                :label="t('requirements.owner')"
                class="select-xs min-w-24 rounded-md border-base-300"
                @update:model-value="setOwner(requirement, $event)"
              />
            </div>
            <p
              v-if="quoteOf(requirement)"
              class="rounded-r-lg border-l-[3px] border-base-300 bg-base-200/50 px-2.5 py-1.5 text-[12px] text-base-content/70"
            >
              {{ quoteOf(requirement) }}
            </p>

            <div class="relative flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span class="w-8 shrink-0 text-base-content/45">{{
                t("requirements.chapters")
              }}</span>
              <span
                v-for="section in requirement.sections"
                :key="section.sectionId"
                class="flex items-center gap-1 rounded-md border border-base-300 px-1.5 py-0.5"
              >
                <button
                  type="button"
                  class="max-w-56 truncate hover:text-primary"
                  @click="openDocument(section.documentId)"
                >
                  {{ section.documentTitle }} · {{ section.sectionTitle }}
                </button>
                <button
                  type="button"
                  class="text-base-content/30 hover:text-error"
                  :aria-label="t('requirements.removeAria', { title: section.sectionTitle })"
                  @click="toggleChapter(requirement, section.sectionId)"
                >
                  <X :size="10" aria-hidden="true" />
                </button>
              </span>
              <span v-if="!requirement.sections.length" class="text-base-content/40">{{
                t("requirements.noChapters")
              }}</span>
              <button
                type="button"
                class="px-1 text-[13px] text-base-content/50 hover:text-base-content"
                :aria-label="t('requirements.linkChapter')"
                @click="
                  picker =
                    picker?.requirementId === requirement.id && picker?.kind === 'chapter'
                      ? null
                      : { requirementId: requirement.id, kind: 'chapter' }
                "
              >
                +
              </button>
              <LinkPicker
                v-if="picker?.requirementId === requirement.id && picker.kind === 'chapter'"
                :options="chapterOptions()"
                :checked="chapterChecked(requirement)"
                @toggle="toggleChapter(requirement, $event)"
                @close="picker = null"
              />
            </div>

            <div class="relative flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span class="w-8 shrink-0 text-base-content/45">{{ t("requirements.tasks") }}</span>
              <span
                v-for="task in requirement.tasks"
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
                  {{ task.title }} · {{ statusLabel(task.status) }}
                </button>
                <button
                  type="button"
                  class="text-base-content/30 hover:text-error"
                  :aria-label="t('requirements.removeAria', { title: task.title })"
                  @click="toggleTask(requirement, task.id)"
                >
                  <X :size="10" aria-hidden="true" />
                </button>
              </span>
              <span v-if="!requirement.tasks.length" class="text-base-content/40">{{
                t("requirements.noTasks")
              }}</span>
              <button
                type="button"
                class="px-1 text-[13px] text-base-content/50 hover:text-base-content"
                :aria-label="t('requirements.linkTask')"
                @click="
                  picker =
                    picker?.requirementId === requirement.id && picker?.kind === 'task'
                      ? null
                      : { requirementId: requirement.id, kind: 'task' }
                "
              >
                +
              </button>
              <LinkPicker
                v-if="picker?.requirementId === requirement.id && picker.kind === 'task'"
                :options="taskOptions(requirement)"
                :checked="taskChecked(requirement)"
                @toggle="toggleTask(requirement, $event)"
                @close="picker = null"
              />
            </div>

            <div class="flex flex-wrap items-center gap-1.5 text-[11.5px]">
              <span class="w-8 shrink-0 text-base-content/45">{{ t("requirements.issues") }}</span>
              <span
                v-for="issue in requirement.issues"
                :key="issue.id"
                class="flex items-center gap-1 rounded-md border border-base-300 px-1.5 py-0.5"
              >
                <span
                  class="h-1.5 w-1.5 rounded-full"
                  :class="
                    issue.status === 'resolved'
                      ? 'bg-success'
                      : issue.status === 'doing'
                        ? 'bg-warning'
                        : 'bg-base-content/25'
                  "
                ></span>
                <button
                  type="button"
                  class="max-w-56 truncate hover:text-primary"
                  @click="emit('focus-issue', issue.id)"
                >
                  {{ issue.title }}
                </button>
                <button
                  type="button"
                  class="text-base-content/30 hover:text-error"
                  :aria-label="t('requirements.removeAria', { title: issue.title })"
                  @click="unlinkIssue(issue.id)"
                >
                  <X :size="10" aria-hidden="true" />
                </button>
              </span>
              <span v-if="!requirement.issues.length" class="text-base-content/40">{{
                t("requirements.noIssues")
              }}</span>
            </div>

            <div class="flex items-center gap-2 text-[12px]">
              <Plus :size="11" class="shrink-0 text-base-content/45" aria-hidden="true" />
              <input
                v-model="taskDrafts[requirement.id]"
                class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-base-content/40"
                :placeholder="t('requirements.newTaskPlaceholder')"
                @keydown.enter="onTaskKey($event, requirement)"
              />
            </div>

            <div class="text-[11.5px]">
              <button
                type="button"
                class="text-base-content/55 hover:text-base-content"
                @click="toggleHistory(requirement)"
              >
                {{ t("requirements.history") }}
              </button>
              <div v-if="historyOpen(requirement)" class="mt-1 space-y-0.5">
                <p
                  v-for="change in history(requirement)"
                  :key="change.id"
                  class="text-base-content/60"
                >
                  <span class="mr-2 font-mono text-base-content/40">{{
                    changeTime(change.createdAt)
                  }}</span>
                  {{ historyText(change) }}
                </p>
                <p v-if="!history(requirement).length" class="text-base-content/40">
                  {{ t("requirements.historyEmpty") }}
                </p>
              </div>
            </div>
          </div>
        </li>
      </ul>
      <p v-else class="mt-2 text-[12px] text-base-content/50">{{ t("requirements.empty") }}</p>
      <div class="mt-2 flex items-center gap-2 border-t border-base-200 pt-2 text-[12.5px]">
        <Plus :size="11" class="shrink-0 text-base-content/60" aria-hidden="true" />
        <input
          v-model="newTitle"
          class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-base-content/45"
          :placeholder="t('requirements.addPlaceholder')"
          :aria-label="t('requirements.addAria')"
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

    <div class="rounded-xl bg-base-100 px-3 py-2">
      <div class="flex items-center gap-2 border-b border-base-200 pb-1.5">
        <span class="text-[12px] font-semibold"
          >{{ t("requirements.documents") }} {{ documents.length }}</span
        >
        <span class="text-[11px] text-base-content/40">{{ t("requirements.uploadHint") }}</span>
        <input
          ref="uploadInput"
          type="file"
          accept=".md,.markdown,.txt,.docx,.pdf"
          class="hidden"
          @change="onFile"
        />
        <button
          type="button"
          class="ml-auto text-[12px] text-base-content/60 hover:text-base-content"
          :disabled="requirementsVM.state.uploading"
          @click="openUpload"
        >
          {{
            requirementsVM.state.uploading ? t("requirements.uploading") : t("requirements.upload")
          }}
        </button>
      </div>
      <button
        v-for="document in documents"
        :key="document.id"
        type="button"
        class="flex w-full items-center gap-2 border-t border-base-200 py-1.5 text-left text-[12px] first:border-t-0 hover:text-primary"
        :aria-label="t('requirements.openDocumentAria', { title: document.title })"
        @click="openDocument(document.id)"
      >
        <span class="min-w-0 flex-1 truncate">{{ document.sourceName }}</span>
        <span class="shrink-0 text-[11px] text-base-content/45">{{
          t("requirements.documentChapters", { count: document.sections.length })
        }}</span>
        <ChevronRight :size="12" class="shrink-0 text-base-content/30" aria-hidden="true" />
      </button>
      <p v-if="!documents.length" class="py-1.5 text-[12px] text-base-content/50">
        {{ t("requirements.noDocuments") }}
      </p>
    </div>

    <DocumentSheet v-if="requirementsVM.state.openDocumentId" />
    <StatusPipeline v-if="statusOpen" :project-id="props.projectId" @close="statusOpen = false" />
  </section>
</template>

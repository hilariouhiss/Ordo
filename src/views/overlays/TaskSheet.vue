<script setup lang="ts">
import { X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { validEffort } from "../../lib/capture";
import { localDate, shortDate, todayIso } from "../../lib/dates";
import { errorText, t, type MessageKey } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { backdropMotion, listItemMotion, sheetPanelMotion } from "../../lib/motion";
import { addMember, archiveTask, ownerCandidates } from "../../model/ipc";
import { overdueDays } from "../../model/mappers";
import type { Person, Priority, Status } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { taskSheetVM } from "../../viewmodels/taskSheetVM";
import DateField from "../components/DateField.vue";

const statusOptions: { value: Status; key: MessageKey }[] = [
  { value: "todo", key: "task.statusTodo" },
  { value: "doing", key: "task.statusDoing" },
  { value: "done", key: "task.statusDone" },
];

const form = reactive({
  title: "",
  projectId: null as string | null,
  categoryId: null as string | null,
  ownerId: null as string | null,
  startDate: "",
  dueDate: "",
  note: "",
  tags: [] as string[],
  effortDays: 1,
  priority: "normal" as Priority,
  status: "todo" as Status,
});
const candidates = ref<Person[]>([]);
const stepDraft = ref("");
const noteDraft = ref("");
const tagDraft = ref("");

const late = computed(() => overdueDays(taskSheetVM.state.task?.dueDate ?? null, todayIso()));
const hasSteps = computed(() => (taskSheetVM.state.task?.steps.length ?? 0) > 0);

async function refreshCandidates(projectId: string | null): Promise<void> {
  candidates.value = await ownerCandidates(projectId);
}

// Step and status edits return a fresh task; only a different task reseeds the form.
let seededFor: string | null = null;

watch(
  () => taskSheetVM.state.task,
  async (task) => {
    if (!task) return;
    if (seededFor === task.id) {
      // Steps change the derived status, so keep the buttons in step without reseeding.
      form.status = task.status;
      return;
    }
    seededFor = task.id;
    form.title = task.title;
    form.projectId = task.projectId;
    form.categoryId = task.categoryId;
    form.ownerId = task.ownerId;
    form.startDate = task.startDate ?? "";
    form.dueDate = task.dueDate ?? "";
    form.note = task.note ?? "";
    form.tags = task.tags.map((tag) => tag.name);
    form.effortDays = task.effortDays;
    form.priority = task.priority;
    form.status = task.status;
    await refreshCandidates(task.projectId);
  },
  { immediate: true },
);

async function onProjectChange(): Promise<void> {
  await refreshCandidates(form.projectId);
  // Switching project is an explicit choice: drop an owner the new project does not know.
  if (form.ownerId && !candidates.value.some((person) => person.id === form.ownerId)) {
    form.ownerId = null;
  }
}

async function save(): Promise<void> {
  const task = taskSheetVM.state.task;
  if (!task) return;
  try {
    if (form.projectId && form.ownerId && !candidates.value.some((p) => p.id === form.ownerId)) {
      await addMember(form.projectId, form.ownerId, null);
    }
    if (await taskSheetVM.saveForm(form)) taskSheetVM.close();
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}

async function setStatus(status: Status): Promise<void> {
  const before = taskSheetVM.state.task?.startDate;
  await taskSheetVM.setStatus(status);
  form.status = status;
  const after = taskSheetVM.state.task?.startDate;
  // The backend fills an empty start date when the task starts; show it without
  // overwriting a date the user has typed but not saved yet.
  if (!form.startDate && !before && after) form.startDate = after;
}

function onPriorityChange(event: Event): void {
  form.priority = (event.target as HTMLSelectElement).value as Priority;
}

function onEffortChange(event: Event): void {
  const input = event.target as HTMLInputElement;
  const value = Number(input.value);
  if (validEffort(value)) form.effortDays = value;
  input.value = String(form.effortDays);
}

function addTag(): void {
  const name = tagDraft.value.trim();
  if (!name || form.tags.includes(name)) return;
  form.tags.push(name);
  tagDraft.value = "";
}

function removeTag(name: string): void {
  form.tags = form.tags.filter((tag) => tag !== name);
}

async function archive(): Promise<void> {
  const task = taskSheetVM.state.task;
  if (!task) return;
  await archiveTask(task.id);
  taskSheetVM.close();
}

async function submitStep(): Promise<void> {
  const title = stepDraft.value.trim();
  if (!title) return;
  await taskSheetVM.add(title);
  stepDraft.value = "";
}

async function saveNote(): Promise<void> {
  if (!noteDraft.value.trim()) return;
  await taskSheetVM.addNote(noteDraft.value);
  noteDraft.value = "";
}

function onStepKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void submitStep();
}

function onNoteKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void saveNote();
}

function onTagKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  addTag();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") taskSheetVM.close();
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <!-- Close on press outside: a click that ends a title drag-select targets the backdrop. -->
  <motion.div
    v-bind="backdropMotion"
    class="fixed inset-0 z-60 flex justify-end bg-neutral/40"
    @mousedown.left.self="taskSheetVM.close()"
  >
    <motion.aside
      v-bind="sheetPanelMotion"
      class="h-full w-full max-w-[440px] overflow-y-auto bg-base-100 p-5 shadow-2xl"
    >
      <div class="flex items-start gap-2">
        <h2 class="text-[17px] font-semibold leading-snug">{{ taskSheetVM.state.task?.title }}</h2>
        <button
          class="ml-auto text-base-content/30"
          :aria-label="t('common.close')"
          @click="taskSheetVM.close()"
        >
          <X :size="15" aria-hidden="true" />
        </button>
      </div>

      <p v-if="taskSheetVM.state.error" class="mt-2 text-[12px] text-error">
        {{ errorText(taskSheetVM.state.error) }}
      </p>

      <template v-if="taskSheetVM.state.task">
        <label class="mt-4 block text-[11px] text-base-content/45">{{ t("task.title") }}</label>
        <input v-model="form.title" class="input input-sm mt-1 w-full rounded-lg border-base-300" />

        <div v-if="!hasSteps" class="mt-3">
          <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">
            {{ t("task.status") }}
          </div>
          <div class="mt-1.5 flex gap-1.5">
            <button
              v-for="option in statusOptions"
              :key="option.value"
              class="btn btn-xs rounded-md border-base-300 font-normal"
              :class="
                form.status === option.value
                  ? 'border-0 bg-primary text-primary-content'
                  : 'bg-base-100'
              "
              @click="setStatus(option.value)"
            >
              {{ t(option.key) }}
            </button>
          </div>
        </div>

        <div class="mt-4 text-[10.5px] font-medium tracking-wide text-base-content/40">
          {{ t("task.steps") }}
        </div>
        <AnimatePresence as="div" mode="popLayout" :initial="false" class="mt-1.5 space-y-1">
          <motion.div
            v-for="(s, i) in taskSheetVM.state.task.steps"
            :key="s.id"
            v-bind="listItemMotion"
            class="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-base-200"
          >
            <span class="w-3 text-[10px] text-base-content/30">{{ i + 1 }}</span>
            <button
              class="size-4 shrink-0 rounded-full border-[1.5px]"
              :class="s.done ? 'border-success bg-success' : 'border-base-content/25'"
              @click="taskSheetVM.toggle(s.id)"
            ></button>
            <span class="text-[12.5px]" :class="{ 'text-base-content/40 line-through': s.done }">
              {{ s.title }}
            </span>
            <span
              v-if="!s.done && taskSheetVM.state.task.steps.findIndex((x) => !x.done) === i"
              class="badge badge-ghost badge-xs text-primary"
            >
              {{ t("task.current") }}
            </span>
            <button
              class="ml-auto text-base-content/25"
              :aria-label="t('task.deleteStepAria')"
              @click="taskSheetVM.remove(s.id)"
            >
              <X :size="13" aria-hidden="true" />
            </button>
          </motion.div>
        </AnimatePresence>

        <input
          v-model="stepDraft"
          class="mt-1 w-full bg-transparent px-1 py-1.5 text-[12px] outline-none placeholder:text-base-content/35"
          :placeholder="t('task.stepPlaceholder')"
          @keydown.enter="onStepKey"
        />

        <p class="mt-2 rounded-lg bg-success/10 px-3 py-2 text-[11px] text-success">
          {{ t("task.stepsHint") }}
        </p>

        <label class="mt-3 block text-[11px] text-base-content/45">
          {{ t("task.project") }}
          <select
            v-model="form.projectId"
            class="select select-sm mt-1 w-full rounded-lg border-base-300"
            @change="onProjectChange"
          >
            <option :value="null">{{ t("task.noProject") }}</option>
            <option v-for="project in appVM.state.projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select>
        </label>

        <div class="mt-2 grid grid-cols-2 gap-2">
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.category") }}
            <select
              v-model="form.categoryId"
              class="select select-sm mt-1 w-full rounded-lg border-base-300"
            >
              <option :value="null">{{ t("common.uncategorized") }}</option>
              <option v-for="c in appVM.state.categories" :key="c.id" :value="c.id">
                {{ c.name }}
              </option>
            </select>
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.owner") }}
            <select
              v-model="form.ownerId"
              class="select select-sm mt-1 w-full rounded-lg border-base-300"
            >
              <option :value="null">{{ t("task.unassigned") }}</option>
              <option
                v-if="form.ownerId && !candidates.some((p) => p.id === form.ownerId)"
                :value="form.ownerId"
              >
                {{ appVM.state.people.find((p) => p.id === form.ownerId)?.name }}
              </option>
              <option v-for="p in candidates" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select>
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.priority") }}
            <select
              :value="form.priority"
              class="select select-sm mt-1 w-full rounded-lg border-base-300"
              @change="onPriorityChange"
            >
              <option value="high">{{ t("task.priorityHigh") }}</option>
              <option value="normal">{{ t("task.priorityNormal") }}</option>
              <option value="low">{{ t("task.priorityLow") }}</option>
            </select>
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.start") }}
            <DateField
              v-model="form.startDate"
              class="input input-sm mt-1 w-full rounded-lg border-base-300"
            />
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.due") }}
            <DateField
              v-model="form.dueDate"
              class="input input-sm mt-1 w-full rounded-lg border-base-300"
            />
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.effort") }}
            <input
              :value="form.effortDays"
              type="number"
              min="0.5"
              max="60"
              step="0.5"
              class="input input-sm mt-1 w-full rounded-lg border-base-300"
              @change="onEffortChange"
            />
          </label>
        </div>

        <div class="mt-3">
          <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">
            {{ t("task.tags") }}
          </div>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            <AnimatePresence mode="popLayout" :initial="false">
              <motion.span
                v-for="tag in form.tags"
                :key="tag"
                v-bind="listItemMotion"
                class="badge badge-ghost badge-sm gap-1.5"
              >
                {{ tag }}
                <button
                  class="text-base-content/30"
                  :aria-label="t('task.removeTagAria')"
                  @click="removeTag(tag)"
                >
                  <X :size="12" aria-hidden="true" />
                </button>
              </motion.span>
            </AnimatePresence>
            <input
              v-model="tagDraft"
              class="input input-xs w-24 rounded-md border-dashed border-base-300 bg-transparent"
              :placeholder="t('task.addTag')"
              @keydown.enter="onTagKey"
            />
          </div>
        </div>

        <div v-if="taskSheetVM.state.task.delays.length" class="mt-3">
          <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">
            {{ t("task.delays") }}
          </div>
          <div
            v-for="d in taskSheetVM.state.task.delays"
            :key="d.id"
            class="mt-1 rounded-lg border border-base-300 px-3 py-1.5 text-[11px] text-base-content/60"
          >
            <span class="tabular-nums text-base-content/40">
              {{ shortDate(localDate(d.createdAt)) }}
            </span>
            {{ d.reason || t("task.noReason") }}
            <span v-if="d.kind === 'reschedule'" class="text-base-content/40">
              · {{ shortDate(d.oldDue) }} → {{ shortDate(d.newDue) }}
            </span>
          </div>
        </div>

        <div v-if="late > 0 && taskSheetVM.state.task.status !== 'done'" class="mt-3">
          <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">
            {{ t("task.overdueNote", { days: late }) }}
          </div>
          <div class="mt-1 flex items-center gap-1.5">
            <input
              v-model="noteDraft"
              class="input input-sm flex-1 rounded-lg border-base-300"
              :placeholder="t('task.notePlaceholder')"
              @keydown.enter="onNoteKey"
            />
            <button
              class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
              @click="saveNote"
            >
              {{ t("task.saveNote") }}
            </button>
          </div>
        </div>

        <label class="mt-3 block text-[11px] text-base-content/45">
          {{ t("common.note") }}
          <textarea
            v-model="form.note"
            class="textarea textarea-sm mt-1 w-full rounded-lg border-base-300"
            rows="2"
          ></textarea>
        </label>

        <div class="mt-5 flex justify-end gap-2">
          <button
            class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
            @click="archive"
          >
            {{ t("common.archive") }}
          </button>
          <button
            class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
            @click="taskSheetVM.close()"
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
      </template>
    </motion.aside>
  </motion.div>
</template>

<script setup lang="ts">
import { ArrowLeft, Hourglass, Pencil, X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { localDate, shortDate, todayIso } from "../../lib/dates";
import { askConfirm, askWaiting } from "../../lib/dialog";
import { formatEffort } from "../../lib/effort";
import { errorText, t, type MessageKey } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { backdropMotion, listItemMotion, sheetPanelMotion } from "../../lib/motion";
import { currentSubtask } from "../../lib/subtasks";
import { effortForFinish, timingAnchor, workdayOnOrBefore } from "../../lib/timing";
import { waitDefaults, waitingOnName } from "../../lib/waiting";
import {
  addMember,
  addSubtask,
  archiveTask,
  deleteSubtask,
  getTask,
  ownerCandidates,
  resumeTask,
  setDelayReason,
  setTaskStatus,
  unarchiveTask,
  waitTask,
} from "../../model/ipc";
import { daysSince, overdueDays } from "../../model/mappers";
import type { Delay, Person, Priority, Status, Task } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import {
  formFinish,
  syncActualPreview,
  taskSheetVM,
  type TaskForm,
} from "../../viewmodels/taskSheetVM";
import { undoVM } from "../../viewmodels/undoVM";
import DateField from "../components/DateField.vue";
import EffortField from "../components/EffortField.vue";

const statusOptions: { value: Status; key: MessageKey }[] = [
  { value: "todo", key: "task.statusTodo" },
  { value: "doing", key: "task.statusDoing" },
  { value: "done", key: "task.statusDone" },
];

const timeOptions: { value: boolean; key: MessageKey }[] = [
  { value: false, key: "task.shared" },
  { value: true, key: "task.exclusive" },
];

/** The draft lives in the view model, so drilling into a subtask can park it intact. */
const form = computed<TaskForm>(() => taskSheetVM.state.form!);
const task = computed(() => taskSheetVM.state.task);
const hasSubtasks = computed(() => (task.value?.children.length ?? 0) > 0);
/** A task with subtasks takes its effort, dates and status from them. */
const derived = computed(() => hasSubtasks.value);
/** A rule owns this task's day and time, so its estimate fields stay read-only too. */
const ruleOwned = computed(() => Boolean(task.value?.expectedFinishTime));
const locked = computed(() => derived.value || ruleOwned.value);
const doneCount = computed(
  () => task.value?.children.filter((child) => child.status === "done").length ?? 0,
);
const childrenEffort = computed(
  () => task.value?.children.reduce((sum, child) => sum + child.effortMinutes, 0) ?? 0,
);
const backTitle = computed(() => taskSheetVM.state.stack.at(-1)?.task.title ?? "");

const editingDelayId = ref<string | null>(null);
const delayDraft = ref("");
const delayInput = ref<HTMLInputElement | null>(null);

const candidates = ref<Person[]>([]);
const subtaskDraft = ref("");
const tagDraft = ref("");
const titleInput = ref<HTMLTextAreaElement | null>(null);

/** The title wraps, so the field grows with its lines instead of scrolling sideways. */
function resizeTitle(): void {
  const el = titleInput.value;
  if (!el) return;
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight + 2}px`;
}

function onTitleEnter(event: KeyboardEvent): void {
  if (!isImeEnter(event)) event.preventDefault();
}

// The sheet mounts as soon as it opens, before the task lands: the getter stays null-safe.
watch(
  () => taskSheetVM.state.form?.title,
  () => void nextTick(resizeTitle),
  { flush: "post" },
);

const late = computed(() => overdueDays(task.value?.expectedFinishDate ?? null, todayIso()));
const waitingName = computed(() =>
  task.value ? waitingOnName(task.value, appVM.state.people) : null,
);
const waitingDays = computed(() =>
  task.value?.waitingSince ? daysSince(task.value.waitingSince, todayIso()) : 0,
);

/** The waiting strip writes at once, like archiving: it is a state, not a draft field. */
async function openWaiting(): Promise<void> {
  const current = task.value;
  if (!current) return;
  const draft = await askWaiting(
    t("task.waitDialogTitle", { title: current.title }),
    waitDefaults(current, appVM.state.people, todayIso()),
  );
  if (!draft) return;
  try {
    taskSheetVM.applyTask(await waitTask(current.id, draft.personId, draft.followUpDate || null));
    undoVM.pushUndo(t("undo.waiting", { title: current.title }), async () => {
      if (current.waiting) {
        const day =
          current.followUpDate && current.followUpDate >= todayIso() ? current.followUpDate : null;
        await waitTask(current.id, current.waitingOnId, day);
      } else {
        await resumeTask(current.id);
      }
    });
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}

/** A reply arrived: the task rejoins the week, and undo parks it on the same wait. */
async function markReplied(): Promise<void> {
  const current = task.value;
  if (!current) return;
  try {
    taskSheetVM.applyTask(await resumeTask(current.id));
    undoVM.pushUndo(t("undo.resumed", { title: current.title }), async () => {
      const day =
        current.followUpDate && current.followUpDate >= todayIso() ? current.followUpDate : null;
      await waitTask(current.id, current.waitingOnId, day);
    });
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}

function setDelayInput(element: unknown): void {
  delayInput.value = element instanceof HTMLInputElement ? element : null;
}

async function editDelay(delay: Delay): Promise<void> {
  editingDelayId.value = delay.id;
  delayDraft.value = delay.reason ?? "";
  await nextTick();
  delayInput.value?.focus();
  delayInput.value?.select();
}

function cancelDelay(): void {
  editingDelayId.value = null;
}

/** A delay record is written already, so its reason lands at once, like the waiting strip. */
async function commitDelay(): Promise<void> {
  const id = editingDelayId.value;
  const current = task.value;
  if (!id || !current) return;
  editingDelayId.value = null;
  const reason = delayDraft.value.trim();
  if (reason === (current.delays.find((delay) => delay.id === id)?.reason ?? "")) return;
  try {
    taskSheetVM.applyTask(await setDelayReason(id, reason));
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}

async function refreshCandidates(projectId: string | null): Promise<void> {
  candidates.value = await ownerCandidates(projectId);
}

// A new task (or the way back to a parent) loads its own owner candidates; the draft is the
// view model's, so re-reading the same task must not clear what the user typed.
let seededFor: string | null = null;

watch(
  () => task.value?.id ?? null,
  async (id) => {
    if (!id) {
      seededFor = null;
      return;
    }
    if (seededFor === id) return;
    seededFor = id;
    subtaskDraft.value = "";
    tagDraft.value = "";
    await refreshCandidates(task.value?.projectId ?? null);
  },
  { immediate: true },
);

async function onProjectChange(): Promise<void> {
  await refreshCandidates(form.value.projectId);
  // Switching project is an explicit choice: drop an owner the new project does not know.
  if (form.value.ownerId && !candidates.value.some((person) => person.id === form.value.ownerId)) {
    form.value.ownerId = null;
  }
}

async function save(): Promise<void> {
  if (!task.value) return;
  // A focused field still owes the draft its value; leaving it commits first.
  (document.activeElement as HTMLElement | null)?.blur();
  try {
    if (
      form.value.projectId &&
      form.value.ownerId &&
      !candidates.value.some((p) => p.id === form.value.ownerId)
    ) {
      await addMember(form.value.projectId, form.value.ownerId, null);
    }
    if (await taskSheetVM.saveSheet()) {
      // A saved subtask goes back to the umbrella it belongs to instead of closing the sheet.
      if (taskSheetVM.state.stack.length) await taskSheetVM.back();
      else taskSheetVM.close();
    }
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}

function setStatus(status: Status): void {
  form.value.status = status;
}

/** Actual times are a draft too: the pair previews here and is written on save. */
function onActualEdit(edited: "start" | "finish" | "effort"): void {
  taskSheetVM.state.error = syncActualPreview(form.value, edited);
}

/** A picked finish day sets the estimate that many workdays would need. */
function onFinishPicked(value: string): void {
  form.value.expectedFinishPicked = true;
  if (!value) return;
  // A weekend pick reads as the Friday before it, the last day the estimate counts.
  const finish = workdayOnOrBefore(value);
  form.value.expectedFinishDate = finish;
  const effort = effortForFinish(finishMin.value, finish);
  if (effort === null) {
    taskSheetVM.state.error = finish < finishMin.value ? "finish_before_start" : "finish_too_far";
    return;
  }
  form.value.effortMinutes = effort;
}

/** The earliest finish day a picked start allows; the date picker refuses earlier days. */
const finishMin = computed(() => timingAnchor(todayIso(), form.value.expectedStartDate || null));

/** The estimate or the start moved: the preview follows unless something else owns the day. */
function refreshFinishPreview(): void {
  form.value.expectedFinishPicked = false;
  if (locked.value) return;
  form.value.expectedFinishDate = formFinish(form.value);
}

/** Leaving the sheet drops the draft: nothing was written. */
function closeSheet(): void {
  taskSheetVM.close();
}

function onPriorityChange(event: Event): void {
  form.value.priority = (event.target as HTMLSelectElement).value as Priority;
}

function addTag(): void {
  const name = tagDraft.value.trim();
  const lower = name.toLowerCase();
  if (!name || form.value.tags.some((tag) => tag.toLowerCase() === lower)) return;
  form.value.tags.push(name);
  tagDraft.value = "";
}

function removeTag(name: string): void {
  form.value.tags = form.value.tags.filter((tag) => tag !== name);
}

async function archive(): Promise<void> {
  const current = task.value;
  if (!current) return;
  taskSheetVM.state.error = null;
  try {
    await archiveTask(current.id);
    undoVM.pushUndo(t("undo.archivedTask", { title: current.title }), async () => {
      // Only the archive flag; restoring through the archive page would reopen finished work.
      await unarchiveTask(current.id);
    });
    taskSheetVM.close();
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}

/** Adds a subtask at once: the rollup it changes is what the grid shows. */
async function submitSubtask(): Promise<void> {
  const parent = task.value;
  const title = subtaskDraft.value.trim();
  if (!parent || !title) return;
  taskSheetVM.state.error = null;
  try {
    taskSheetVM.applyTask(await addSubtask(parent.id, title));
    subtaskDraft.value = "";
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}

function onSubtaskKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void submitSubtask();
}

/** A subtask is a task: ticking it is a status change, and the parent follows. */
async function toggleSubtask(child: Task): Promise<void> {
  const parent = task.value;
  if (!parent) return;
  taskSheetVM.state.error = null;
  try {
    await setTaskStatus(child.id, child.status === "done" ? "todo" : "done");
    taskSheetVM.applyTask(await getTask(parent.id));
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}

async function removeSubtask(child: Task): Promise<void> {
  if (
    !(await askConfirm(
      t("task.deleteSubtaskTitle"),
      t("task.deleteSubtaskMessage", { title: child.title }),
    ))
  )
    return;
  taskSheetVM.state.error = null;
  try {
    taskSheetVM.applyTask(await deleteSubtask(child.id));
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}

function openSubtask(child: Task): void {
  void taskSheetVM.drill(child.id);
}

function openParent(): void {
  const id = task.value?.parentId;
  if (!id) return;
  // The way back keeps this draft; only the parent's derived fields are refreshed.
  if (taskSheetVM.state.stack.at(-1)?.task.id === id) void taskSheetVM.back();
  else void taskSheetVM.drill(id);
}

function goBack(): void {
  void taskSheetVM.back();
}

function onTagKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  addTag();
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") void closeSheet();
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <!-- Close on press outside: a click that ends a title drag-select targets the backdrop. -->
  <motion.div
    v-bind="backdropMotion"
    class="window-scrim fixed inset-0 z-60 flex justify-end bg-neutral/40"
    @mousedown.left.self="closeSheet()"
  >
    <motion.aside
      v-bind="sheetPanelMotion"
      class="window-edge-panel flex h-full w-full max-w-[480px] flex-col overflow-y-auto bg-base-100 p-5 shadow-2xl"
    >
      <p v-if="taskSheetVM.state.error" class="mb-1 text-[11px] text-error">
        {{ errorText(taskSheetVM.state.error) }}
      </p>

      <template v-if="task">
        <button
          v-if="taskSheetVM.state.stack.length"
          class="mb-1 inline-flex w-fit items-center gap-1 text-[11px] text-primary"
          @click="goBack()"
        >
          <ArrowLeft :size="12" aria-hidden="true" />
          {{ t("task.backToParent", { title: backTitle }) }}
        </button>
        <button
          v-else-if="task.parentId"
          class="mb-1 inline-flex w-fit items-center gap-1 text-[11px] text-primary"
          @click="openParent()"
        >
          <ArrowLeft :size="12" aria-hidden="true" />
          {{ t("task.parentTask", { title: task.parentTitle ?? "" }) }}
        </button>

        <div class="flex items-start gap-2">
          <textarea
            ref="titleInput"
            v-model="form.title"
            rows="1"
            class="min-w-0 flex-1 resize-none overflow-hidden rounded-lg border border-base-300 bg-base-100 px-3 py-2 text-[17px] font-semibold leading-snug outline-none focus:border-primary/60"
            :aria-label="t('task.title')"
            @keydown.enter="onTitleEnter"
          ></textarea>
          <button
            class="mt-2 shrink-0 text-base-content/30"
            :aria-label="t('common.close')"
            @click="closeSheet()"
          >
            <X :size="15" aria-hidden="true" />
          </button>
        </div>

        <label class="mt-2 block text-[11px] text-base-content/45">
          {{ t("task.description") }}
          <textarea
            v-model="form.note"
            class="mt-1 h-[72px] w-full resize-none rounded-lg border border-base-300 bg-base-100 px-2.5 py-1.5 text-[12.5px] leading-5 outline-none placeholder:text-base-content/35 focus:border-primary/60"
            rows="3"
            :placeholder="t('task.descriptionPlaceholder')"
          ></textarea>
        </label>

        <div v-if="!hasSubtasks" class="mt-2 flex items-center gap-1.5">
          <span class="text-[11px] text-base-content/40">{{ t("task.status") }}</span>
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
          <button
            v-if="task.waiting || task.status !== 'done'"
            class="btn btn-xs rounded-md font-normal"
            :class="
              task.waiting ? 'border-0 bg-info text-info-content' : 'border-base-300 bg-base-100'
            "
            @click="openWaiting"
          >
            {{ t("task.waitingNoName") }}
          </button>
        </div>

        <div
          v-if="task.waiting"
          class="mt-2 flex items-center gap-1.5 rounded-lg bg-info/10 px-2.5 py-1.5 text-[11px] text-info"
        >
          <Hourglass :size="12" aria-hidden="true" />
          <span class="min-w-0 truncate">
            {{ waitingName ? t("task.waitingOn", { name: waitingName }) : t("task.waitingNoName") }}
            <template v-if="waitingDays > 0">
              · {{ t("task.waitingFor", { days: waitingDays }) }}
            </template>
            ·
            {{
              task.followUpDate
                ? t("task.followUpOn", { date: shortDate(task.followUpDate) })
                : t("task.noFollowUp")
            }}
          </span>
          <span class="ml-auto flex shrink-0 items-center gap-0.5">
            <button class="rounded-md px-1.5 py-0.5 hover:bg-info/10" @click="markReplied">
              {{ t("task.replied") }}
            </button>
            <button class="rounded-md px-1.5 py-0.5 hover:bg-info/10" @click="openWaiting">
              {{ t("task.changeFollowUp") }}
            </button>
          </span>
        </div>
        <button
          v-else-if="hasSubtasks && task.status !== 'done'"
          class="mt-1.5 inline-flex items-center gap-1 text-[10.5px] text-base-content/40 hover:text-info"
          @click="openWaiting"
        >
          <Hourglass :size="12" aria-hidden="true" />
          {{ t("task.waitingNoName") }}
        </button>

        <div
          v-if="!task.parentId"
          class="mt-3 flex items-center gap-2 text-[11px] font-medium tracking-wide text-base-content/40"
          :title="t('task.subtasksHint')"
        >
          {{ t("task.subtasks") }}
          <span v-if="hasSubtasks" class="ml-auto font-normal tracking-normal">
            {{
              t("task.subtasksProgress", {
                done: doneCount,
                total: task.children.length,
                effort: formatEffort(childrenEffort),
              })
            }}
          </span>
        </div>
        <AnimatePresence as="div" mode="popLayout" :initial="false" class="mt-1 space-y-0.5">
          <motion.div
            v-for="(child, i) in task.children"
            :key="child.id"
            v-bind="listItemMotion"
            class="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-base-200"
          >
            <span class="w-3 text-[10.5px] text-base-content/30">{{ i + 1 }}</span>
            <button
              class="size-4 shrink-0 rounded-full border-[1.5px]"
              :class="
                child.status === 'done' ? 'border-success bg-success' : 'border-base-content/25'
              "
              :aria-label="t('task.doneAria', { title: child.title })"
              @click="toggleSubtask(child)"
            ></button>
            <button
              class="min-w-0 flex-1 truncate text-left text-[13px]"
              :class="{ 'text-base-content/40 line-through': child.status === 'done' }"
              @click="openSubtask(child)"
            >
              {{ child.title }}
            </button>
            <span
              v-if="currentSubtask(task.children)?.id === child.id"
              class="badge badge-ghost badge-xs shrink-0 text-primary"
            >
              {{ t("task.current") }}
            </span>
            <span class="shrink-0 font-mono text-[11px] tabular-nums text-base-content/45">
              {{ formatEffort(child.effortMinutes) }}
            </span>
            <span class="w-11 shrink-0 text-right text-[10.5px] text-base-content/40">
              {{ shortDate(child.expectedFinishDate) }}
            </span>
            <button
              class="shrink-0 text-base-content/25"
              :aria-label="t('task.deleteSubtaskAria')"
              @click="removeSubtask(child)"
            >
              <X :size="13" aria-hidden="true" />
            </button>
          </motion.div>
        </AnimatePresence>

        <input
          v-if="!task.parentId"
          v-model="subtaskDraft"
          class="mt-1 w-full bg-transparent px-1 py-1.5 text-[12.5px] outline-none placeholder:text-base-content/35"
          :placeholder="t('task.subtaskPlaceholder')"
          @keydown.enter="onSubtaskKey"
        />

        <!-- One frame for the four attributes, the way the effort field joins amount + unit. -->
        <div
          class="mt-3 grid grid-cols-[1.15fr_0.85fr_0.8fr_0.6fr] text-[11px] text-base-content/45"
        >
          <span class="px-2.5">{{ t("task.project") }}</span>
          <span class="px-2.5">{{ t("task.category") }}</span>
          <span class="px-2.5">{{ t("task.owner") }}</span>
          <span class="px-2.5">{{ t("task.priority") }}</span>
        </div>
        <div class="mt-1 flex overflow-hidden rounded-lg border border-base-300 bg-base-100">
          <select
            v-model="form.projectId"
            class="select select-sm min-w-0 flex-[1.15] rounded-none border-0 bg-base-100 pl-2.5"
            @change="onProjectChange"
          >
            <option :value="null">{{ t("task.noProject") }}</option>
            <option v-for="project in appVM.state.projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select>
          <select
            v-model="form.categoryId"
            class="select select-sm min-w-0 flex-[0.85] rounded-none border-0 border-l border-base-300 bg-base-100 pl-2.5"
          >
            <option :value="null">{{ t("common.uncategorized") }}</option>
            <option v-for="c in appVM.state.categories" :key="c.id" :value="c.id">
              {{ c.name }}
            </option>
          </select>
          <select
            v-model="form.ownerId"
            class="select select-sm min-w-0 flex-[0.8] rounded-none border-0 border-l border-base-300 bg-base-100 pl-2.5"
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
          <select
            :value="form.priority"
            class="select select-sm min-w-0 flex-[0.6] rounded-none border-0 border-l border-base-300 bg-base-100 pl-2.5"
            @change="onPriorityChange"
          >
            <option value="high">{{ t("task.priorityHigh") }}</option>
            <option value="normal">{{ t("task.priorityNormal") }}</option>
            <option value="low">{{ t("task.priorityLow") }}</option>
          </select>
        </div>

        <!-- Expected and actual share one grid, so both rows keep the same columns. -->
        <div class="mt-4 grid grid-cols-[1fr_auto_1fr] items-start gap-x-2">
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.expectedStart") }}
            <DateField
              v-model="form.expectedStartDate"
              :disabled="locked"
              class="input input-sm mt-1 w-full rounded-md border-base-300"
              @update:model-value="refreshFinishPreview"
            />
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.effort") }}
            <div class="mt-1">
              <EffortField
                v-model="form.effortMinutes"
                :disabled="locked"
                @update:model-value="refreshFinishPreview"
              />
            </div>
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.expectedFinish") }}
            <span
              v-if="locked"
              class="input input-sm mt-1 flex w-full items-center rounded-md border-base-300 bg-base-200/30 tabular-nums text-base-content/60"
            >
              {{ shortDate(form.expectedFinishDate) || t("common.none") }}
              <template v-if="ruleOwned">· {{ task.expectedFinishTime }}</template>
            </span>
            <DateField
              v-else
              v-model="form.expectedFinishDate"
              :min="finishMin"
              class="input input-sm mt-1 w-full rounded-md border-base-300"
              @update:model-value="onFinishPicked"
            />
          </label>
          <div class="col-span-3 mt-2 h-px bg-base-300"></div>

          <label class="block text-[11px] text-base-content/45">
            {{ t("task.actualStart") }}
            <DateField
              v-model="form.actualStartDate"
              :disabled="derived"
              class="input input-sm mt-1 w-full rounded-md border-base-300"
              @update:model-value="onActualEdit('start')"
            />
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.actualEffort") }}
            <div class="mt-1">
              <EffortField
                v-model="form.actualEffortMinutes"
                optional
                :disabled="derived"
                :label="t('task.actualEffort')"
                @update:model-value="onActualEdit('effort')"
              />
            </div>
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.actualFinish") }}
            <DateField
              v-model="form.actualFinishDate"
              :disabled="derived"
              class="input input-sm mt-1 w-full rounded-md border-base-300"
              @update:model-value="onActualEdit('finish')"
            />
          </label>
          <p v-if="derived" class="col-span-3 mt-1 text-[10.5px] text-base-content/45">
            {{ t("task.subtasksRolledUp") }}
          </p>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] text-base-content/40">{{ t("task.timeMode") }}</span>
          <button
            v-for="option in timeOptions"
            :key="String(option.value)"
            class="btn btn-xs rounded-md border-base-300 font-normal"
            :class="
              form.exclusive === option.value
                ? 'border-0 bg-primary text-primary-content'
                : 'bg-base-100'
            "
            @click="form.exclusive = option.value"
          >
            {{ t(option.key) }}
          </button>
          <span class="text-[10.5px] text-base-content/40">{{
            t(form.exclusive ? "task.exclusiveHint" : "task.sharedHint")
          }}</span>
        </div>

        <div class="mt-3 flex flex-wrap items-center gap-1.5">
          <span class="text-[11px] text-base-content/40">{{ t("task.tags") }}</span>
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

        <div v-if="task.delays.length" class="mt-3">
          <div class="text-[11px] font-medium tracking-wide text-base-content/40">
            {{ t("task.delays") }}
          </div>
          <div v-for="d in task.delays" :key="d.id" class="mt-1">
            <div
              v-if="editingDelayId === d.id"
              class="flex items-center rounded-lg border border-primary/60 px-3 py-1 text-[11px]"
            >
              <input
                :ref="setDelayInput"
                v-model="delayDraft"
                class="min-w-0 flex-1 bg-transparent outline-none placeholder:text-base-content/35"
                :placeholder="t('task.delayReason')"
                :aria-label="t('task.delayReason')"
                @blur="commitDelay"
                @keydown.enter.prevent="commitDelay"
                @keydown.esc.stop="cancelDelay"
              />
            </div>
            <button
              v-else
              class="flex w-full items-center gap-1.5 rounded-lg border border-base-300 px-3 py-1.5 text-left text-[11px] text-base-content/60 hover:border-primary/50"
              :title="t('task.delayReason')"
              @click="editDelay(d)"
            >
              <span class="shrink-0 tabular-nums text-base-content/40">
                {{ shortDate(localDate(d.createdAt)) }}
              </span>
              <span class="min-w-0 truncate">{{ d.reason || t("task.noReason") }}</span>
              <span v-if="d.kind === 'reschedule'" class="shrink-0 text-base-content/40">
                · {{ shortDate(d.oldDue) }} → {{ shortDate(d.newDue) }}
              </span>
              <Pencil :size="11" class="ml-auto shrink-0 text-base-content/25" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div v-if="late > 0 && task.status !== 'done'" class="mt-3">
          <div class="text-[11px] font-medium tracking-wide text-base-content/40">
            {{ t("task.overdueNote", { days: late }) }}
          </div>
          <input
            v-model="taskSheetVM.state.note"
            class="input input-sm mt-1 w-full rounded-lg border-base-300"
            :placeholder="t('task.notePlaceholder')"
          />
        </div>

        <div class="mt-4 flex justify-end gap-2">
          <button
            v-if="!task.parentId"
            class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
            @click="archive"
          >
            {{ t("common.archive") }}
          </button>
          <button
            class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
            @click="closeSheet()"
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

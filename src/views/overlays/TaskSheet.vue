<script setup lang="ts">
import { RotateCcw, X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { localDate, shortDate, shortDateTime, todayIso, weekdayLabel } from "../../lib/dates";
import { errorText, t, type MessageKey } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { backdropMotion, listItemMotion, sheetPanelMotion } from "../../lib/motion";
import { allocateSteps, currentStep, formatStepClock, formatStepEffort } from "../../lib/steps";
import { formatEffort, parseEffortText } from "../../lib/effort";
import { addMember, archiveTask, ownerCandidates } from "../../model/ipc";
import { overdueDays } from "../../model/mappers";
import type { Person, Priority, Status, Step } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { finishPreview, taskSheetVM } from "../../viewmodels/taskSheetVM";
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

const form = reactive({
  title: "",
  projectId: null as string | null,
  categoryId: null as string | null,
  ownerId: null as string | null,
  expectedStartDate: "",
  note: "",
  tags: [] as string[],
  effortMinutes: 480,
  priority: "normal" as Priority,
  status: "todo" as Status,
  exclusive: true,
});
const candidates = ref<Person[]>([]);
const stepDraft = ref("");
const noteDraft = ref("");
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

watch(
  () => form.title,
  () => void nextTick(resizeTitle),
  { flush: "post" },
);

const late = computed(() =>
  overdueDays(taskSheetVM.state.task?.expectedFinishDate ?? null, todayIso()),
);
const hasSteps = computed(() => (taskSheetVM.state.task?.steps.length ?? 0) > 0);
const steps = computed(() => taskSheetVM.state.task?.steps ?? []);
const allocation = computed(() => allocateSteps(form.effortMinutes, steps.value));
const allocatedMinutes = computed(() => allocation.value.allocated);
const remainingMinutes = computed(() => form.effortMinutes - allocatedMinutes.value);
const hasManualSteps = computed(() => steps.value.some((step) => step.effortMinutes != null));
const minutesById = computed(
  () => new Map(allocation.value.steps.map((row) => [row.id, row.minutes])),
);
const editingStepId = ref<string | null>(null);
const stepEffortDraft = ref("");
const stepEffortInput = ref<HTMLInputElement | HTMLInputElement[] | null>(null);
const raisedTo = ref<number | null>(null);

function stepMinutes(stepId: string): number {
  return minutesById.value.get(stepId) ?? 0;
}

function barWidth(minutes: number): string {
  return allocatedMinutes.value > 0 ? `${(minutes / allocatedMinutes.value) * 100}%` : "0%";
}

function focusStepEffort(): void {
  const input = Array.isArray(stepEffortInput.value)
    ? stepEffortInput.value[0]
    : stepEffortInput.value;
  input?.focus();
  input?.select();
}

function startStepEdit(step: Step): void {
  editingStepId.value = step.id;
  stepEffortDraft.value = formatStepClock(stepMinutes(step.id));
  void nextTick(focusStepEffort);
}

function cancelStepEdit(): void {
  editingStepId.value = null;
  stepEffortDraft.value = "";
}

async function saveStepMinutes(step: Step, minutes: number | null): Promise<void> {
  const before = taskSheetVM.state.task?.effortMinutes ?? 0;
  try {
    await taskSheetVM.setStepEffort(step.id, minutes);
    const after = taskSheetVM.state.task?.effortMinutes ?? before;
    if (after > before) {
      raisedTo.value = after;
      // Follow the raised estimate unless the user is already editing the field.
      if (form.effortMinutes === before) form.effortMinutes = after;
    }
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}

async function commitStepEdit(step: Step): Promise<void> {
  if (editingStepId.value !== step.id) return;
  const minutes = parseEffortText(stepEffortDraft.value);
  const current = stepMinutes(step.id);
  editingStepId.value = null;
  stepEffortDraft.value = "";
  if (minutes === null) return;
  if (step.effortMinutes == null && minutes === current) return;
  if (step.effortMinutes === minutes) return;
  await saveStepMinutes(step, minutes);
}

function onStepEffortEnter(event: KeyboardEvent, step: Step): void {
  if (isImeEnter(event)) return;
  void commitStepEdit(step);
}

async function resetStepEffort(step: Step): Promise<void> {
  await saveStepMinutes(step, null);
}

async function evenSteps(): Promise<void> {
  try {
    await taskSheetVM.evenSteps();
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}
/** The finish always follows the estimate; it is shown, never typed. */
const expectedFinish = computed(() => {
  const task = taskSheetVM.state.task;
  return task ? finishPreview(task, form) : "";
});
const expectedFinishLabel = computed(
  () => `${shortDate(expectedFinish.value)} ${weekdayLabel(expectedFinish.value)}`,
);
const hasActual = computed(() => {
  const task = taskSheetVM.state.task;
  return (
    !!task &&
    (task.actualStartAt !== null ||
      task.actualFinishAt !== null ||
      task.actualEffortMinutes !== null)
  );
});

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
    raisedTo.value = null;
    form.title = task.title;
    form.projectId = task.projectId;
    form.categoryId = task.categoryId;
    form.ownerId = task.ownerId;
    form.expectedStartDate = task.expectedStartDate ?? "";
    form.note = task.note ?? "";
    form.tags = task.tags.map((tag) => tag.name);
    form.effortMinutes = task.effortMinutes;
    form.priority = task.priority;
    form.status = task.status;
    form.exclusive = task.exclusive;
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

/** Runs one sheet action; a failed write must stay visible instead of vanishing. */
async function run(action: () => Promise<unknown>): Promise<boolean> {
  taskSheetVM.state.error = null;
  try {
    await action();
    return true;
  } catch (e) {
    taskSheetVM.state.error = String(e);
    return false;
  }
}

async function setStatus(status: Status): Promise<void> {
  if (!(await run(() => taskSheetVM.setStatus(status)))) return;
  form.status = status;
}

function onPriorityChange(event: Event): void {
  form.priority = (event.target as HTMLSelectElement).value as Priority;
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
  taskSheetVM.state.error = null;
  try {
    await archiveTask(task.id);
    taskSheetVM.close();
  } catch (e) {
    taskSheetVM.state.error = String(e);
  }
}

async function submitStep(): Promise<void> {
  const title = stepDraft.value.trim();
  if (!title) return;
  if (await run(() => taskSheetVM.add(title))) stepDraft.value = "";
}

async function saveNote(): Promise<void> {
  if (!noteDraft.value.trim()) return;
  if (await run(() => taskSheetVM.addNote(noteDraft.value))) noteDraft.value = "";
}

function onStepKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void submitStep();
}

/** Step buttons: the sheet shows its own error, so the result is dropped. */
function toggleStep(step: Step): void {
  void run(() => taskSheetVM.toggle(step.id));
}

function removeStep(step: Step): void {
  void run(() => taskSheetVM.remove(step.id));
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
    class="window-scrim fixed inset-0 z-60 flex justify-end bg-neutral/40"
    @mousedown.left.self="taskSheetVM.close()"
  >
    <motion.aside
      v-bind="sheetPanelMotion"
      class="window-edge-panel flex h-full w-full max-w-[440px] flex-col overflow-y-auto bg-base-100 p-5 shadow-2xl"
    >
      <p v-if="taskSheetVM.state.error" class="mb-1 text-[11px] text-error">
        {{ errorText(taskSheetVM.state.error) }}
      </p>

      <template v-if="taskSheetVM.state.task">
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
            @click="taskSheetVM.close()"
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

        <div v-if="!hasSteps" class="mt-2 flex items-center gap-1.5">
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
        </div>

        <div
          class="mt-3 text-[11px] font-medium tracking-wide text-base-content/40"
          :title="t('task.stepsHint')"
        >
          {{ t("task.steps") }}
        </div>
        <AnimatePresence as="div" mode="popLayout" :initial="false" class="mt-1 space-y-0.5">
          <motion.div
            v-for="(s, i) in taskSheetVM.state.task.steps"
            :key="s.id"
            v-bind="listItemMotion"
            class="flex items-center gap-2 rounded-lg px-1 py-1.5 hover:bg-base-200"
          >
            <span class="w-3 text-[10.5px] text-base-content/30">{{ i + 1 }}</span>
            <button
              class="size-4 shrink-0 rounded-full border-[1.5px]"
              :class="s.done ? 'border-success bg-success' : 'border-base-content/25'"
              @click="toggleStep(s)"
            ></button>
            <span
              class="min-w-0 flex-1 truncate text-[13px]"
              :class="{ 'text-base-content/40 line-through': s.done }"
            >
              {{ s.title }}
            </span>
            <span
              v-if="currentStep(taskSheetVM.state.task.steps)?.id === s.id"
              class="badge badge-ghost badge-xs shrink-0 text-primary"
            >
              {{ t("task.current") }}
            </span>
            <div class="flex shrink-0 items-center gap-1.5">
              <input
                v-if="editingStepId === s.id"
                ref="stepEffortInput"
                v-model="stepEffortDraft"
                class="input input-xs w-14 rounded-md border-base-300 bg-base-100 px-1 text-center font-mono text-[11px] tabular-nums"
                :aria-label="t('task.stepEffortAria', { title: s.title })"
                @keydown.enter="onStepEffortEnter($event, s)"
                @keydown.esc.prevent="cancelStepEdit"
                @blur="commitStepEdit(s)"
              />
              <button
                v-else
                type="button"
                class="border-b border-dotted border-base-content/30 pb-px font-mono text-[11px] tabular-nums"
                :class="s.effortMinutes == null ? 'text-base-content/45' : 'text-base-content/70'"
                :title="
                  s.effortMinutes == null
                    ? t('task.stepAutoHint')
                    : formatStepEffort(stepMinutes(s.id))
                "
                :aria-label="t('task.stepEffortAria', { title: s.title })"
                @click.stop="startStepEdit(s)"
              >
                {{ formatStepClock(stepMinutes(s.id)) }}
                <span
                  v-if="s.effortMinutes == null"
                  class="ml-1 font-sans text-[8.5px] text-base-content/30"
                  >{{ t("task.stepAuto") }}</span
                >
              </button>
              <button
                v-if="s.effortMinutes != null"
                type="button"
                class="text-base-content/25 hover:text-base-content/60"
                :aria-label="t('task.stepResetAria', { title: s.title })"
                :title="t('task.stepResetAria', { title: s.title })"
                @click.stop="resetStepEffort(s)"
              >
                <RotateCcw :size="11" aria-hidden="true" />
              </button>
              <button
                class="text-base-content/25"
                :aria-label="t('task.deleteStepAria')"
                @click="removeStep(s)"
              >
                <X :size="13" aria-hidden="true" />
              </button>
            </div>
          </motion.div>
        </AnimatePresence>

        <input
          v-model="stepDraft"
          class="mt-1 w-full bg-transparent px-1 py-1.5 text-[12.5px] outline-none placeholder:text-base-content/35"
          :placeholder="t('task.stepPlaceholder')"
          @keydown.enter="onStepKey"
        />

        <div v-if="steps.length" class="mt-1">
          <div
            class="flex items-center gap-1.5 text-[11px]"
            :class="remainingMinutes < 0 ? 'text-error' : 'text-base-content/45'"
          >
            <span>
              {{
                t("task.stepsAllocated", {
                  allocated: formatStepEffort(allocatedMinutes),
                  total: formatStepEffort(form.effortMinutes),
                })
              }}
            </span>
            <span v-if="remainingMinutes > 0">
              · {{ t("task.stepsRemaining", { rest: formatStepEffort(remainingMinutes) }) }}
            </span>
            <span v-else-if="remainingMinutes < 0">
              · {{ t("task.stepsOver", { over: formatStepEffort(-remainingMinutes) }) }}
            </span>
            <button v-if="hasManualSteps" class="ml-auto shrink-0 text-primary" @click="evenSteps">
              {{ t("task.evenSteps") }}
            </button>
          </div>
          <div
            v-if="allocatedMinutes > 0"
            class="mt-1 flex h-1 gap-0.5 overflow-hidden rounded-full"
          >
            <i
              v-for="(row, index) in allocation.steps"
              :key="row.id"
              class="block h-1 rounded-full"
              :class="steps[index]?.done ? 'bg-success/40' : 'bg-primary/25'"
              :style="{ width: barWidth(row.minutes) }"
            ></i>
          </div>
        </div>

        <p v-if="raisedTo" class="mt-1 text-[10.5px] text-warning">
          {{ t("task.stepsRaisedTotal", { total: formatStepEffort(raisedTo) }) }}
        </p>

        <div class="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2">
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.project") }}
            <select
              v-model="form.projectId"
              class="select select-sm mt-1 w-full rounded-md border-base-300"
              @change="onProjectChange"
            >
              <option :value="null">{{ t("task.noProject") }}</option>
              <option v-for="project in appVM.state.projects" :key="project.id" :value="project.id">
                {{ project.name }}
              </option>
            </select>
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.category") }}
            <select
              v-model="form.categoryId"
              class="select select-sm mt-1 w-full rounded-md border-base-300"
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
              class="select select-sm mt-1 w-full rounded-md border-base-300"
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
              class="select select-sm mt-1 w-full rounded-md border-base-300"
              @change="onPriorityChange"
            >
              <option value="high">{{ t("task.priorityHigh") }}</option>
              <option value="normal">{{ t("task.priorityNormal") }}</option>
              <option value="low">{{ t("task.priorityLow") }}</option>
            </select>
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.expectedStart") }}
            <DateField
              v-model="form.expectedStartDate"
              class="input input-sm mt-1 w-full rounded-md border-base-300"
            />
            <span
              class="mt-0.5 block text-[10.5px] leading-4 text-base-content/40"
              :title="t('task.expectedFinishDerived')"
            >
              {{ t("task.expectedFinish") }} {{ expectedFinishLabel }}
              <span v-if="taskSheetVM.state.task?.expectedFinishTime">
                {{ taskSheetVM.state.task.expectedFinishTime }}
              </span>
            </span>
          </label>
          <label class="block text-[11px] text-base-content/45">
            {{ t("task.effort") }}
            <div class="mt-1">
              <EffortField v-model="form.effortMinutes" />
            </div>
          </label>
        </div>

        <div
          v-if="hasActual"
          class="mt-3 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-base-content/45"
        >
          <span>
            {{ t("task.actualStart") }}
            <span class="text-base-content/70">{{
              shortDateTime(taskSheetVM.state.task?.actualStartAt ?? null) || t("common.none")
            }}</span>
          </span>
          <span>
            {{ t("task.actualFinish") }}
            <span class="text-base-content/70">{{
              shortDateTime(taskSheetVM.state.task?.actualFinishAt ?? null) || t("common.none")
            }}</span>
          </span>
          <span>
            {{ t("task.actualEffort") }}
            <span class="text-base-content/70">{{
              taskSheetVM.state.task?.actualEffortMinutes
                ? formatEffort(taskSheetVM.state.task.actualEffortMinutes)
                : t("common.none")
            }}</span>
          </span>
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

        <div v-if="taskSheetVM.state.task.delays.length" class="mt-3">
          <div class="text-[11px] font-medium tracking-wide text-base-content/40">
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
          <div class="text-[11px] font-medium tracking-wide text-base-content/40">
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

        <div class="mt-4 flex justify-end gap-2">
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

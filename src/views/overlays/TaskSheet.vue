<script setup lang="ts">
import { X } from "@lucide/vue";
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { shortDate, todayIso } from "../../lib/dates";
import { isImeEnter } from "../../lib/keys";
import { addMember, archiveTask, ownerCandidates } from "../../model/ipc";
import { overdueDays } from "../../model/mappers";
import type { Person, Status } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import { taskSheetVM } from "../../viewmodels/taskSheetVM";

const statusOptions: { value: Status; label: string }[] = [
  { value: "todo", label: "未开始" },
  { value: "doing", label: "进行中" },
  { value: "done", label: "已完成" },
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
  if (form.ownerId && !candidates.value.some((p) => p.id === form.ownerId)) {
    form.ownerId = null;
  }
}

watch(
  () => taskSheetVM.state.task,
  async (task) => {
    if (!task) return;
    form.title = task.title;
    form.projectId = task.projectId;
    form.categoryId = task.categoryId;
    form.ownerId = task.ownerId;
    form.startDate = task.startDate ?? "";
    form.dueDate = task.dueDate ?? "";
    form.note = task.note ?? "";
    form.tags = task.tags.map((tag) => tag.name);
    form.status = task.status;
    await refreshCandidates(task.projectId);
  },
  { immediate: true },
);

async function onProjectChange(): Promise<void> {
  await refreshCandidates(form.projectId);
}

async function save(): Promise<void> {
  const task = taskSheetVM.state.task;
  if (!task) return;
  if (form.projectId && form.ownerId && !candidates.value.some((p) => p.id === form.ownerId)) {
    await addMember(form.projectId, form.ownerId, null);
  }
  await taskSheetVM.saveForm(form);
}

async function setStatus(status: Status): Promise<void> {
  await taskSheetVM.setStatus(status);
  form.status = status;
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
  <div class="fixed inset-0 z-60 flex justify-end bg-neutral/40" @click.self="taskSheetVM.close()">
    <aside class="h-full w-full max-w-[440px] overflow-y-auto bg-base-100 p-5 shadow-2xl">
      <div class="flex items-start gap-2">
        <h2 class="text-[17px] font-semibold leading-snug">{{ taskSheetVM.state.task?.title }}</h2>
        <button class="ml-auto text-base-content/30" aria-label="关闭" @click="taskSheetVM.close()">
          <X :size="15" aria-hidden="true" />
        </button>
      </div>

      <p v-if="taskSheetVM.state.error" class="mt-2 text-[12px] text-error">
        {{ taskSheetVM.state.error }}
      </p>

      <template v-if="taskSheetVM.state.task">
        <label class="mt-4 block text-[11px] text-base-content/45">标题</label>
        <input v-model="form.title" class="input input-sm mt-1 w-full rounded-lg border-base-300" />

        <div v-if="!hasSteps" class="mt-3">
          <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">状态</div>
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
              {{ option.label }}
            </button>
          </div>
        </div>

        <div class="mt-4 text-[10.5px] font-medium tracking-wide text-base-content/40">步骤</div>
        <div class="mt-1.5 space-y-1">
          <div
            v-for="(s, i) in taskSheetVM.state.task.steps"
            :key="s.id"
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
              当前
            </span>
            <button
              class="ml-auto text-base-content/25"
              aria-label="删除这一步"
              @click="taskSheetVM.remove(s.id)"
            >
              <X :size="13" aria-hidden="true" />
            </button>
          </div>
        </div>

        <input
          v-model="stepDraft"
          class="mt-1 w-full bg-transparent px-1 py-1.5 text-[12px] outline-none placeholder:text-base-content/35"
          placeholder="+ 再加一步（回车继续写）"
          @keydown.enter="onStepKey"
        />

        <p class="mt-2 rounded-lg bg-success/10 px-3 py-2 text-[11px] text-success">
          勾完最后一步，这件事自动变成已完成。
        </p>

        <label class="mt-3 block text-[11px] text-base-content/45">
          项目
          <select
            v-model="form.projectId"
            class="select select-sm mt-1 w-full rounded-lg border-base-300"
            @change="onProjectChange"
          >
            <option :value="null">无项目</option>
            <option v-for="project in appVM.state.projects" :key="project.id" :value="project.id">
              {{ project.name }}
            </option>
          </select>
        </label>

        <div class="mt-2 grid grid-cols-2 gap-2">
          <label class="block text-[11px] text-base-content/45">
            分类
            <select
              v-model="form.categoryId"
              class="select select-sm mt-1 w-full rounded-lg border-base-300"
            >
              <option :value="null">未分类</option>
              <option v-for="c in appVM.state.categories" :key="c.id" :value="c.id">
                {{ c.name }}
              </option>
            </select>
          </label>
          <label class="block text-[11px] text-base-content/45">
            负责人
            <select
              v-model="form.ownerId"
              class="select select-sm mt-1 w-full rounded-lg border-base-300"
            >
              <option :value="null">未指定</option>
              <option v-for="p in candidates" :key="p.id" :value="p.id">
                {{ p.name }}
              </option>
            </select>
          </label>
          <label class="block text-[11px] text-base-content/45">
            开始
            <input
              v-model="form.startDate"
              type="date"
              class="input input-sm mt-1 w-full rounded-lg border-base-300"
            />
          </label>
          <label class="block text-[11px] text-base-content/45">
            截止
            <input
              v-model="form.dueDate"
              type="date"
              class="input input-sm mt-1 w-full rounded-lg border-base-300"
            />
          </label>
        </div>

        <div class="mt-3">
          <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">标签</div>
          <div class="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span v-for="tag in form.tags" :key="tag" class="badge badge-ghost badge-sm gap-1.5">
              {{ tag }}
              <button class="text-base-content/30" aria-label="移除标签" @click="removeTag(tag)">
                <X :size="12" aria-hidden="true" />
              </button>
            </span>
            <input
              v-model="tagDraft"
              class="input input-xs w-24 rounded-md border-dashed border-base-300 bg-transparent"
              placeholder="+ 标签"
              @keydown.enter="onTagKey"
            />
          </div>
        </div>

        <div v-if="taskSheetVM.state.task.delays.length" class="mt-3">
          <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">延期记录</div>
          <div
            v-for="d in taskSheetVM.state.task.delays"
            :key="d.id"
            class="mt-1 rounded-lg border border-base-300 px-3 py-1.5 text-[11px] text-base-content/60"
          >
            <span class="tabular-nums text-base-content/40">
              {{ d.createdAt.slice(5, 10).replace("-", "/") }}
            </span>
            {{ d.reason || "未写原因" }}
            <span v-if="d.kind === 'reschedule'" class="text-base-content/40">
              · {{ shortDate(d.oldDue) }} → {{ shortDate(d.newDue) }}
            </span>
          </div>
        </div>

        <div v-if="late > 0 && taskSheetVM.state.task.status !== 'done'" class="mt-3">
          <div class="text-[10.5px] font-medium tracking-wide text-base-content/40">
            逾期 {{ late }} 天 · 记一句原因
          </div>
          <div class="mt-1 flex items-center gap-1.5">
            <input
              v-model="noteDraft"
              class="input input-sm flex-1 rounded-lg border-base-300"
              placeholder="为什么还没交"
              @keydown.enter="onNoteKey"
            />
            <button
              class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
              @click="saveNote"
            >
              记下
            </button>
          </div>
        </div>

        <label class="mt-3 block text-[11px] text-base-content/45">
          备注
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
            归档
          </button>
          <button
            class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
            @click="taskSheetVM.close()"
          >
            关闭
          </button>
          <button
            class="btn btn-sm rounded-lg border-0 bg-primary text-primary-content"
            @click="save"
          >
            保存
          </button>
        </div>
      </template>
    </aside>
  </div>
</template>

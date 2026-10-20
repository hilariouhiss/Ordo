<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { shortDate, todayIso } from "../../lib/dates";
import { overdueDays } from "../../model/mappers";
import type { TaskFields } from "../../model/types";
import { archiveTask } from "../../model/ipc";
import { appVM } from "../../viewmodels/appVM";
import { taskSheetVM } from "../../viewmodels/taskSheetVM";

const form = reactive({
  title: "",
  categoryId: null as string | null,
  ownerId: null as string | null,
  startDate: "",
  dueDate: "",
  note: "",
});
const stepDraft = ref("");
const noteDraft = ref("");

const late = computed(() => overdueDays(taskSheetVM.state.task?.dueDate ?? null, todayIso()));

watch(
  () => taskSheetVM.state.task,
  (task) => {
    if (!task) return;
    form.title = task.title;
    form.categoryId = task.categoryId;
    form.ownerId = task.ownerId;
    form.startDate = task.startDate ?? "";
    form.dueDate = task.dueDate ?? "";
    form.note = task.note ?? "";
  },
  { immediate: true },
);

async function save(): Promise<void> {
  const task = taskSheetVM.state.task;
  if (!task) return;
  const fields: TaskFields = {
    title: form.title.trim() || task.title,
    projectId: task.projectId,
    categoryId: form.categoryId,
    ownerId: form.ownerId,
    startDate: form.startDate || null,
    dueDate: form.dueDate || null,
    note: form.note || null,
  };
  await taskSheetVM.save(fields);
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

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") taskSheetVM.close();
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="fixed inset-0 z-40 flex justify-end bg-neutral/40" @click.self="taskSheetVM.close()">
    <aside class="h-full w-full max-w-[440px] overflow-y-auto bg-base-100 p-5 shadow-2xl">
      <div class="flex items-start gap-2">
        <h2 class="text-[17px] font-semibold leading-snug">{{ taskSheetVM.state.task?.title }}</h2>
        <button class="ml-auto text-base-content/30" @click="taskSheetVM.close()">✕</button>
      </div>

      <p v-if="taskSheetVM.state.error" class="mt-2 text-[12px] text-error">
        {{ taskSheetVM.state.error }}
      </p>

      <template v-if="taskSheetVM.state.task">
        <label class="mt-4 block text-[11px] text-base-content/45">标题</label>
        <input v-model="form.title" class="input input-sm mt-1 w-full rounded-lg border-base-300" />

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
              class="ml-auto text-[10px] text-base-content/25"
              @click="taskSheetVM.remove(s.id)"
            >
              ✕
            </button>
          </div>
        </div>

        <input
          v-model="stepDraft"
          class="mt-1 w-full bg-transparent px-1 py-1.5 text-[12px] outline-none placeholder:text-base-content/35"
          placeholder="+ 再加一步（回车继续写）"
          @keydown.enter="submitStep"
        />

        <p class="mt-2 rounded-lg bg-success/10 px-3 py-2 text-[11px] text-success">
          勾完最后一步，这件事自动变成已完成。
        </p>

        <div class="mt-4 grid grid-cols-2 gap-2">
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
              <option v-for="p in appVM.state.people" :key="p.id" :value="p.id">
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
              @keydown.enter="
                taskSheetVM.addNote(noteDraft);
                noteDraft = '';
              "
            />
            <button
              class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
              @click="
                taskSheetVM.addNote(noteDraft);
                noteDraft = '';
              "
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

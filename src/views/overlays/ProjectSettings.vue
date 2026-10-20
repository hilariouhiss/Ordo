<script setup lang="ts">
import { X } from "@lucide/vue";
import { onMounted, reactive, ref } from "vue";
import { isImeEnter } from "../../lib/keys";
import * as ipc from "../../model/ipc";
import { appVM } from "../../viewmodels/appVM";
import { projectsVM } from "../../viewmodels/projectsVM";

const props = defineProps<{ id: string }>();
const emit = defineEmits<{ close: [] }>();

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
  return appVM.state.people.find((p) => p.id === id)?.name ?? "（未知）";
}

async function save(): Promise<void> {
  error.value = "";
  try {
    await ipc.updateProject(props.id, form.name.trim(), form.dueDate || null);
    await reload();
    await projectsVM.load();
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
  emit("close");
}

async function remove(): Promise<void> {
  if (!window.confirm("永久删除这个项目？任务会一起消失，不能撤销。")) return;
  await ipc.deleteProject(props.id);
  await projectsVM.load();
  emit("close");
}
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-neutral/40 p-4"
    @click.self="emit('close')"
  >
    <div class="w-full max-w-[520px] rounded-2xl bg-base-100 p-5 shadow-2xl">
      <div class="flex items-center">
        <h2 class="text-[15px] font-semibold">项目设置</h2>
        <button class="ml-auto text-base-content/30" aria-label="关闭" @click="emit('close')">
          <X :size="15" aria-hidden="true" />
        </button>
      </div>

      <p v-if="error" class="mt-2 text-[12px] text-error">{{ error }}</p>

      <div class="mt-4 space-y-2 text-[12px]">
        <label class="flex items-center gap-3">
          <span class="w-14 text-base-content/50">名称</span>
          <input v-model="form.name" class="input input-sm flex-1 rounded-lg border-base-300" />
        </label>
        <label class="flex items-center gap-3">
          <span class="w-14 text-base-content/50">截止</span>
          <input
            v-model="form.dueDate"
            type="date"
            class="input input-sm rounded-lg border-base-300"
          />
        </label>
      </div>

      <div class="mt-4">
        <div class="flex items-baseline gap-2">
          <span class="text-[12px] font-medium">成员</span>
          <span class="text-[10.5px] text-base-content/40">任务负责人从这里选</span>
        </div>
        <div class="mt-2 flex flex-wrap items-center gap-1.5">
          <span
            v-for="personId in form.memberIds"
            :key="personId"
            class="badge badge-ghost badge-md gap-1.5"
          >
            {{ memberNameOf(personId) }}
            <button
              v-if="!appVM.state.people.find((p) => p.id === personId)?.isMe"
              class="text-base-content/30"
              aria-label="移出项目"
              @click="removeMember(personId)"
            >
              <X :size="12" aria-hidden="true" />
            </button>
          </span>
        </div>
        <div class="mt-2 flex items-center gap-2">
          <input
            v-model="memberName"
            class="input input-sm flex-1 rounded-lg border-dashed border-base-300"
            placeholder="从已有人员里选，或输入一个新名字"
            @keydown.enter="onMemberKey"
          />
          <button
            class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
            @click="addMember"
          >
            添加
          </button>
        </div>
        <p class="mt-1.5 text-[10.5px] text-base-content/35">
          只属于这个项目。别的项目要用同一个人，再选一次就行（不会重复建人）。
        </p>
      </div>

      <div class="mt-5 flex items-center gap-2 border-t border-base-200 pt-3">
        <button
          class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
          @click="archive"
        >
          归档项目
        </button>
        <button
          class="btn btn-sm rounded-lg border-error/25 bg-base-100 font-normal text-error"
          @click="remove"
        >
          删除项目
        </button>
        <button
          class="btn btn-sm ml-auto rounded-lg border-0 bg-primary text-primary-content"
          @click="save"
        >
          保存
        </button>
      </div>
    </div>
  </div>
</template>

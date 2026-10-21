<script setup lang="ts">
import { Trash } from "@lucide/vue";
import { ref } from "vue";
import { isImeEnter } from "../lib/keys";
import { appVM } from "../viewmodels/appVM";
import { metaVM } from "../viewmodels/metaVM";

const name = ref("");
const error = ref("");

function explain(e: unknown): string {
  const text = String(e);
  if (text.includes("person_in_use")) return "这个人名下还有任务，先把任务换给别人再删。";
  if (text.includes("person_exists")) return "已经有同名的人了。";
  if (text.includes("empty_person_name")) return "名字不能为空。";
  if (text.includes("cannot_delete_me")) return "「我」不能删。";
  return text;
}

async function add(): Promise<void> {
  if (!name.value.trim()) return;
  error.value = "";
  try {
    await metaVM.addPerson(name.value);
    name.value = "";
  } catch (e) {
    error.value = explain(e);
  }
}

function onKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void add();
}

async function rename(id: string, current: string): Promise<void> {
  const next = window.prompt("名字", current);
  if (!next) return;
  error.value = "";
  try {
    await metaVM.renamePerson(id, next);
  } catch (e) {
    error.value = explain(e);
  }
}

async function remove(id: string, personName: string): Promise<void> {
  if (!window.confirm(`删除「${personName}」？只有没有任何任务引用的人才能删除。`)) return;
  error.value = "";
  try {
    await metaVM.removePerson(id);
  } catch (e) {
    error.value = explain(e);
  }
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">人员</h1>
      <span class="text-[11px] text-base-content/45">人名全局唯一，改名对所有任务生效</span>
    </div>

    <p v-if="error" class="px-1 text-[12px] text-error">{{ error }}</p>

    <ul class="space-y-1.5">
      <li
        v-for="person in appVM.state.people"
        :key="person.id"
        class="flex items-center gap-3 rounded-xl bg-base-100 px-4 py-2.5 text-[12.5px]"
      >
        <span>{{ person.name }}</span>
        <span v-if="person.isMe" class="badge badge-soft badge-primary badge-xs">我</span>
        <button
          class="ml-auto text-base-content/35 hover:text-base-content"
          @click="rename(person.id, person.name)"
        >
          改
        </button>
        <button
          v-if="!person.isMe"
          class="text-base-content/35 hover:text-error"
          aria-label="删除人员"
          @click="remove(person.id, person.name)"
        >
          <Trash :size="14" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <div class="flex items-center gap-2 rounded-xl bg-base-100 px-4 py-2.5">
      <input
        v-model="name"
        class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/40"
        placeholder="新增人员，回车保存"
        @keydown.enter="onKey"
      />
    </div>
    <p class="px-1 text-[10.5px] text-base-content/35">
      新增的人要先在项目设置里加入项目，才能被选为负责人。只有没有任何任务引用的人才能删除。
    </p>
  </section>
</template>

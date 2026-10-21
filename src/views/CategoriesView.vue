<script setup lang="ts">
import { ArrowDown, ArrowUp, Trash } from "@lucide/vue";
import { ref } from "vue";
import { isImeEnter } from "../lib/keys";
import { appVM } from "../viewmodels/appVM";
import { metaVM } from "../viewmodels/metaVM";

const name = ref("");

async function add(): Promise<void> {
  await metaVM.addCategory(name.value);
  name.value = "";
}

function onKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void add();
}

function rename(id: string, current: string): void {
  const next = window.prompt("分类名", current);
  if (next) void metaVM.renameCategory(id, next);
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">分类</h1>
      <span class="text-[11px] text-base-content/45">排序决定项目页里的分组顺序</span>
    </div>

    <ul class="space-y-1.5">
      <li
        v-for="category in appVM.state.categories"
        :key="category.id"
        class="flex items-center gap-3 rounded-xl bg-base-100 px-4 py-2.5 text-[12.5px]"
      >
        <span class="flex-1">{{ category.name }}</span>
        <button
          class="text-base-content/35 hover:text-base-content"
          @click="rename(category.id, category.name)"
        >
          改
        </button>
        <button
          class="text-base-content/35 hover:text-base-content"
          aria-label="上移"
          @click="metaVM.moveCategory(category.id, -1)"
        >
          <ArrowUp :size="14" aria-hidden="true" />
        </button>
        <button
          class="text-base-content/35 hover:text-base-content"
          aria-label="下移"
          @click="metaVM.moveCategory(category.id, 1)"
        >
          <ArrowDown :size="14" aria-hidden="true" />
        </button>
        <button
          class="text-base-content/35 hover:text-error"
          aria-label="删除分类"
          @click="metaVM.removeCategory(category.id)"
        >
          <Trash :size="14" aria-hidden="true" />
        </button>
      </li>
    </ul>

    <div class="flex items-center gap-2 rounded-xl bg-base-100 px-4 py-2.5">
      <input
        v-model="name"
        class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/40"
        placeholder="新增分类，回车保存"
        @keydown.enter="onKey"
      />
    </div>
    <p class="px-1 text-[10.5px] text-base-content/35">删除分类不会删任务，任务会变成未分类。</p>
  </section>
</template>

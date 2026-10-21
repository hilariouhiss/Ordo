<script setup lang="ts">
import { ArrowDown, ArrowUp, Trash } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { ref } from "vue";
import { askConfirm, askText } from "../lib/dialog";
import { isImeEnter } from "../lib/keys";
import { listItemMotion } from "../lib/motion";
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

async function rename(id: string, current: string): Promise<void> {
  const next = await askText("修改分类名", current);
  if (next) await metaVM.renameCategory(id, next);
}

async function remove(id: string, categoryName: string): Promise<void> {
  if (!(await askConfirm("删除分类", `删除「${categoryName}」？任务会变成未分类。`))) return;
  await metaVM.removeCategory(id);
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">分类</h1>
      <span class="text-[11px] text-base-content/45">排序决定项目页里的分组顺序</span>
    </div>

    <AnimatePresence as="ul" mode="popLayout" :initial="false" class="space-y-1.5">
      <motion.li
        v-for="category in appVM.state.categories"
        :key="category.id"
        v-bind="listItemMotion"
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
          @click="remove(category.id, category.name)"
        >
          <Trash :size="14" aria-hidden="true" />
        </button>
      </motion.li>
    </AnimatePresence>

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

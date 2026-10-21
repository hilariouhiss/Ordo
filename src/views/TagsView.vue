<script setup lang="ts">
import { Trash } from "@lucide/vue";
import { ref } from "vue";
import { isImeEnter } from "../lib/keys";
import { appVM } from "../viewmodels/appVM";
import { metaVM } from "../viewmodels/metaVM";

const name = ref("");

async function add(): Promise<void> {
  await metaVM.addTag(name.value);
  name.value = "";
}

function onKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void add();
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">标签</h1>
      <span class="text-[11px] text-base-content/45">删除只影响显示，任务本身不变</span>
    </div>

    <div class="rounded-xl bg-base-100 p-4">
      <p v-if="!appVM.state.tags.length" class="text-[12px] text-base-content/40">
        还没有标签。在任务里输入新标签也会自动收进来。
      </p>
      <div v-else class="flex flex-wrap gap-1.5">
        <span
          v-for="tag in appVM.state.tags"
          :key="tag.id"
          class="badge badge-ghost badge-md gap-1.5"
        >
          {{ tag.name }}
          <button
            class="text-base-content/30 hover:text-error"
            aria-label="删除标签"
            @click="metaVM.removeTag(tag.id)"
          >
            <Trash :size="12" aria-hidden="true" />
          </button>
        </span>
      </div>
      <input
        v-model="name"
        class="input input-sm mt-2 w-full rounded-lg border-dashed border-base-300 bg-transparent"
        placeholder="新增标签，回车保存"
        @keydown.enter="onKey"
      />
      <p class="mt-1.5 text-[10.5px] text-base-content/35">
        删除标签只影响显示，已经打过的任务不受影响。
      </p>
    </div>
  </section>
</template>

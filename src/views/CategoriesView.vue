<script setup lang="ts">
import { ArrowDown, ArrowUp, Trash } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { ref } from "vue";
import { askConfirm, askText } from "../lib/dialog";
import { t } from "../lib/i18n";
import { isImeEnter } from "../lib/keys";
import { listItemMotion } from "../lib/motion";
import { appVM } from "../viewmodels/appVM";
import { metaVM } from "../viewmodels/metaVM";

const name = ref("");
const adding = ref(false);

async function add(): Promise<void> {
  if (adding.value) return;
  adding.value = true;
  try {
    await metaVM.addCategory(name.value);
    name.value = "";
  } finally {
    adding.value = false;
  }
}

function onKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void add();
}

async function rename(id: string, current: string): Promise<void> {
  const next = await askText(t("categories.renameTitle"), current);
  if (next) await metaVM.renameCategory(id, next);
}

async function remove(id: string, categoryName: string): Promise<void> {
  if (
    !(await askConfirm(
      t("categories.deleteTitle"),
      t("categories.deleteMessage", { name: categoryName }),
    ))
  )
    return;
  await metaVM.removeCategory(id);
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">{{ t("categories.title") }}</h1>
      <span class="text-[11px] text-base-content/45">{{ t("categories.hint") }}</span>
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
          {{ t("common.edit") }}
        </button>
        <button
          class="text-base-content/35 hover:text-base-content"
          :aria-label="t('categories.upAria')"
          @click="metaVM.moveCategory(category.id, -1)"
        >
          <ArrowUp :size="14" aria-hidden="true" />
        </button>
        <button
          class="text-base-content/35 hover:text-base-content"
          :aria-label="t('categories.downAria')"
          @click="metaVM.moveCategory(category.id, 1)"
        >
          <ArrowDown :size="14" aria-hidden="true" />
        </button>
        <button
          class="text-base-content/35 hover:text-error"
          :aria-label="t('categories.deleteAria')"
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
        :placeholder="t('categories.placeholder')"
        @keydown.enter="onKey"
      />
    </div>
    <p class="px-1 text-[10.5px] text-base-content/35">{{ t("categories.footer") }}</p>
  </section>
</template>

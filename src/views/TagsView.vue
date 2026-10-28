<script setup lang="ts">
import { Trash } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { ref } from "vue";
import { runWithNotice } from "../lib/dialog";
import { t } from "../lib/i18n";
import { isImeEnter } from "../lib/keys";
import { listItemMotion } from "../lib/motion";
import { appVM } from "../viewmodels/appVM";
import { metaVM } from "../viewmodels/metaVM";

const name = ref("");

async function add(): Promise<void> {
  if (await runWithNotice(() => metaVM.addTag(name.value))) name.value = "";
}

function remove(id: string): void {
  void runWithNotice(() => metaVM.removeTag(id));
}

function onKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void add();
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">{{ t("tags.title") }}</h1>
      <span class="text-[11px] text-base-content/45">{{ t("tags.hint") }}</span>
    </div>

    <div class="rounded-xl bg-base-100 p-4">
      <p v-if="!appVM.state.tags.length" class="text-[12px] text-base-content/40">
        {{ t("tags.empty") }}
      </p>
      <AnimatePresence
        v-else
        as="div"
        mode="popLayout"
        :initial="false"
        class="flex flex-wrap gap-1.5"
      >
        <motion.span
          v-for="tag in appVM.state.tags"
          :key="tag.id"
          v-bind="listItemMotion"
          class="badge badge-ghost badge-md gap-1.5"
        >
          {{ tag.name }}
          <button
            class="text-base-content/30 hover:text-error"
            :aria-label="t('tags.deleteAria')"
            @click="remove(tag.id)"
          >
            <Trash :size="12" aria-hidden="true" />
          </button>
        </motion.span>
      </AnimatePresence>
      <input
        v-model="name"
        class="input input-sm mt-2 w-full rounded-lg border-dashed border-base-300 bg-transparent"
        :placeholder="t('tags.placeholder')"
        @keydown.enter="onKey"
      />
      <p class="mt-1.5 text-[10.5px] text-base-content/35">
        {{ t("tags.footer") }}
      </p>
    </div>
  </section>
</template>

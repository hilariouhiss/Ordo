<script setup lang="ts">
import { Undo2, X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { t } from "../../lib/i18n";
import { undoVM as vm } from "../../viewmodels/undoVM";
</script>

<template>
  <div class="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
    <AnimatePresence>
      <motion.div
        v-if="vm.state.entry"
        :key="vm.state.entry.message"
        role="status"
        class="pointer-events-auto flex max-w-full items-center gap-2.5 rounded-xl bg-neutral px-3 py-2 text-[12px] text-neutral-content shadow-2xl"
        :initial="{ opacity: 0, y: 10 }"
        :animate="{ opacity: 1, y: 0 }"
        :exit="{ opacity: 0, y: 6, transition: { duration: 0.14 } }"
        :transition="{ type: 'spring', stiffness: 480, damping: 36 }"
      >
        <Undo2 :size="14" aria-hidden="true" class="shrink-0 opacity-70" />
        <span class="min-w-0 truncate">{{ vm.state.entry.message }}</span>
        <button
          type="button"
          class="shrink-0 rounded-lg bg-neutral-content/15 px-2.5 py-1 text-[12px] font-normal hover:bg-neutral-content/25 disabled:opacity-50"
          :disabled="vm.state.busy"
          @click="vm.undo()"
        >
          {{ t("undo.action") }}
        </button>
        <span class="shrink-0 text-[10px] opacity-60">{{ t("undo.shortcut") }}</span>
        <button
          type="button"
          class="grid size-5 shrink-0 place-items-center rounded-md opacity-60 hover:bg-neutral-content/15 hover:opacity-100"
          :aria-label="t('undo.dismissAria')"
          @click="vm.dismiss()"
        >
          <X :size="12" aria-hidden="true" />
        </button>
      </motion.div>
    </AnimatePresence>
  </div>
</template>

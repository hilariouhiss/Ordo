<script setup lang="ts">
import { ChevronRight } from "@lucide/vue";
import { motion } from "motion-v";
import { computed } from "vue";
import { springSoft } from "../../lib/motion";
import type { CategoryProgress } from "../../model/types";

const props = defineProps<{
  category: CategoryProgress;
  expanded: boolean;
}>();

const emit = defineEmits<{ toggle: [] }>();

const pct = computed(() =>
  props.category.total ? Math.round((props.category.done / props.category.total) * 100) : 0,
);
</script>

<template>
  <motion.div layout :transition="springSoft" class="rounded-xl bg-base-100 px-3 py-2.5">
    <button class="flex w-full items-center gap-2 text-left" @click="emit('toggle')">
      <span class="w-8 text-[12.5px] font-medium">{{ category.name }}</span>
      <span class="h-1.5 flex-1 overflow-hidden rounded-full bg-base-300">
        <motion.span
          class="block h-full rounded-full bg-primary"
          :initial="{ width: 0 }"
          :animate="{ width: pct + '%' }"
          :transition="springSoft"
        ></motion.span>
      </span>
      <span class="w-8 text-right text-[11px] tabular-nums text-base-content/50">
        {{ category.done }}/{{ category.total }}
      </span>
      <ChevronRight
        :size="12"
        aria-hidden="true"
        :class="[
          'text-base-content/35 transition-transform duration-200',
          { 'rotate-90': expanded },
        ]"
      />
    </button>
    <slot v-if="expanded"></slot>
  </motion.div>
</template>

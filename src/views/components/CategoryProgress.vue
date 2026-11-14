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
  <motion.div layout :transition="springSoft" class="overflow-hidden rounded-lg bg-base-100">
    <button
      class="flex h-9 w-full items-center gap-2 px-3 text-left hover:bg-base-200/50"
      @click="emit('toggle')"
    >
      <span class="w-8 text-[13px] font-medium">{{ category.name }}</span>
      <span class="h-1 flex-1 overflow-hidden rounded-full bg-base-300">
        <motion.span
          class="block h-full rounded-full bg-primary"
          :initial="{ width: 0 }"
          :animate="{ width: pct + '%' }"
          :transition="springSoft"
        ></motion.span>
      </span>
      <span class="w-10 text-right text-[12px] tabular-nums text-base-content/65">
        {{ category.done }}/{{ category.total }}
      </span>
      <ChevronRight
        :size="12"
        aria-hidden="true"
        :class="[
          'text-base-content/60 transition-transform duration-200',
          { 'rotate-90': expanded },
        ]"
      />
    </button>
    <div v-if="expanded" class="border-t border-base-200">
      <slot></slot>
    </div>
  </motion.div>
</template>

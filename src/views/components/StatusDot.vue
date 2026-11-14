<script setup lang="ts">
import { motion } from "motion-v";
import { computed } from "vue";
import { springSnappy } from "../../lib/motion";
import { statusDisplay } from "../../lib/status";
import type { Status } from "../../model/types";

const props = defineProps<{ status: Status; suspended?: boolean; waiting?: boolean }>();
const display = computed(() =>
  statusDisplay(props.status, props.suspended ?? false, props.waiting ?? false),
);
const dotClass = computed(() => {
  switch (display.value) {
    case "done":
      // Settled work recedes: a filled grey dot, not a second green.
      return "border-base-content/45 bg-base-content/45";
    case "doing":
      return "border-primary";
    case "suspended":
      return "border-warning bg-warning/10";
    case "waiting":
      return "border-base-content/40";
    default:
      return "border-base-content/30";
  }
});
</script>

<template>
  <motion.span
    :key="display"
    class="inline-flex shrink-0"
    :initial="{ scale: 0.6 }"
    :animate="{ scale: 1 }"
    :transition="springSnappy"
  >
    <span
      class="relative grid size-4 place-items-center overflow-hidden rounded-full border-[1.5px] transition-colors"
      :class="dotClass"
    >
      <!-- The right half solid, the left open: drawn, not a CSS gradient. -->
      <span
        v-if="display === 'doing'"
        class="absolute inset-y-0 right-0 left-1/2 bg-primary"
        aria-hidden="true"
      ></span>
      <span v-if="display === 'suspended'" class="flex gap-[2px]" aria-hidden="true">
        <span class="h-[6px] w-[2px] rounded-full bg-warning"></span>
        <span class="h-[6px] w-[2px] rounded-full bg-warning"></span>
      </span>
      <span
        v-else-if="display === 'waiting'"
        class="size-1 rounded-full bg-base-content/40"
        aria-hidden="true"
      ></span>
    </span>
  </motion.span>
</template>

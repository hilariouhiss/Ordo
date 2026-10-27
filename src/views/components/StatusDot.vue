<script setup lang="ts">
import { motion } from "motion-v";
import { computed } from "vue";
import { springSnappy } from "../../lib/motion";
import { statusDisplay } from "../../lib/status";
import type { Status } from "../../model/types";

const props = defineProps<{ status: Status; suspended?: boolean }>();
const display = computed(() => statusDisplay(props.status, props.suspended ?? false));
const dotClass = computed(() => {
  switch (display.value) {
    case "done":
      return "border-success bg-success";
    case "doing":
      return "border-primary bg-primary/25";
    case "suspended":
      return "border-warning bg-warning/15";
    default:
      return "border-base-content/25";
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
      class="relative grid size-4 place-items-center rounded-full border-[1.5px] transition-colors"
      :class="dotClass"
    >
      <span v-if="display === 'suspended'" class="flex gap-[2px]" aria-hidden="true">
        <span class="h-[6px] w-[2px] rounded-full bg-warning"></span>
        <span class="h-[6px] w-[2px] rounded-full bg-warning"></span>
      </span>
    </span>
  </motion.span>
</template>

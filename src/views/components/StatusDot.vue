<script setup lang="ts">
import { motion } from "motion-v";
import type { Status } from "../../model/types";
import { springSnappy } from "../../lib/motion";

defineProps<{ status: Status }>();
</script>

<template>
  <motion.span
    :key="status"
    class="inline-flex shrink-0"
    :initial="{ scale: 0.6 }"
    :animate="{ scale: 1 }"
    :transition="springSnappy"
  >
    <span
      class="size-4 rounded-full border-[1.5px] transition-colors"
      :class="{
        'border-base-content/25': status === 'todo',
        'border-primary bg-primary/25': status === 'doing',
        'border-success bg-success': status === 'done',
      }"
    ></span>
  </motion.span>
</template>

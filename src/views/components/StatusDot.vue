<script setup lang="ts">
import type { Status } from "../../model/types";

defineProps<{ status: Status }>();
</script>

<template>
  <span
    class="size-4 shrink-0 rounded-full border-[1.5px]"
    :class="{
      'border-base-content/25': status === 'todo',
      'border-primary bg-primary/25': status === 'doing',
      'border-success bg-success': status === 'done',
    }"
  ></span>
</template>

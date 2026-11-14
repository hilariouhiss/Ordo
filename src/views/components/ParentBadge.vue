<script setup lang="ts">
import { CornerDownRight } from "@lucide/vue";
import { t } from "../../lib/i18n";

/** A subtask's parent, drawn as a breadcrumb before the title. */
defineProps<{ title: string }>();
</script>

<template>
  <span
    class="flex min-w-0 shrink items-center gap-1 text-[11.5px] text-base-content/60"
    :title="t('task.parentTask', { title })"
  >
    <CornerDownRight :size="10" aria-hidden="true" class="shrink-0" />
    <span class="min-w-0 truncate">{{ title }}</span>
    <span class="h-2.5 w-px shrink-0 bg-current opacity-20" aria-hidden="true"></span>
  </span>
</template>

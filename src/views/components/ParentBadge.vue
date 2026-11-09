<script setup lang="ts">
import { CornerDownRight } from "@lucide/vue";
import { t } from "../../lib/i18n";

/** A subtask's parent, so a row of leaves still says which task it belongs to. */
defineProps<{ title: string }>();
</script>

<template>
  <span
    class="badge badge-xs max-w-32 shrink-0 gap-1 border-0 bg-base-content/5 ps-1.5 text-base-content/60"
    :title="t('task.parentTask', { title })"
  >
    <CornerDownRight :size="10" aria-hidden="true" class="shrink-0 opacity-60" />
    <span class="min-w-0 truncate">{{ title }}</span>
  </span>
</template>

<script setup lang="ts">
import { t } from "../../lib/i18n";
import type { Priority } from "../../model/types";

defineProps<{ priority: Priority }>();
</script>

<template>
  <span
    v-if="priority !== 'normal'"
    class="badge badge-xs"
    :class="priority === 'high' ? 'badge-soft badge-warning' : 'badge-ghost'"
  >
    {{ t(priority === "high" ? "task.priorityHigh" : "task.priorityLow") }}
  </span>
</template>

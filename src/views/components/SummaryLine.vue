<script setup lang="ts">
defineProps<{ text: string; copied: boolean }>();
const emit = defineEmits<{ copy: [] }>();
</script>

<template>
  <div class="flex items-center gap-2 rounded-xl bg-base-100 px-3 py-2.5">
    <span class="text-[11.5px] text-base-content/55">{{ text }}</span>
    <button
      class="btn btn-xs ml-auto rounded-md border-base-300 bg-base-200 font-normal"
      @click="emit('copy')"
    >
      {{ copied ? "已复制" : "复制" }}
    </button>
  </div>
</template>

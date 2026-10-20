<script setup lang="ts">
const model = defineModel<string>({ required: true });
const emit = defineEmits<{ submit: [string] }>();
</script>

<template>
  <div class="flex items-center gap-2 rounded-xl bg-base-100 px-4 py-2.5">
    <input
      v-model="model"
      class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/40"
      placeholder="记一句…"
      @keydown.enter="emit('submit', model)"
    />
    <span class="shrink-0 text-[10.5px] text-base-content/35">⏎ 保存</span>
  </div>
</template>

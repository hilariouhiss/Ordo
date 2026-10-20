<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink, RouterView } from "vue-router";
import { appVM } from "./viewmodels/appVM";

onMounted(() => {
  void appVM.load();
});
</script>

<template>
  <div class="min-h-screen bg-base-200 text-base-content">
    <header class="flex items-center gap-4 border-b border-base-300 bg-base-100 px-6 py-3">
      <span class="text-[15px] font-semibold tracking-tight">ordo</span>
      <nav role="tablist" class="tabs tabs-border tabs-sm">
        <RouterLink to="/week" class="tab" active-class="tab-active">本周</RouterLink>
        <RouterLink to="/projects" class="tab" active-class="tab-active">项目</RouterLink>
        <RouterLink to="/archive" class="tab" active-class="tab-active">归档</RouterLink>
      </nav>
      <span v-if="!appVM.state.ready" class="loading loading-spinner loading-xs ml-auto"></span>
    </header>
    <main class="mx-auto max-w-[980px] px-6 py-5">
      <RouterView />
    </main>
  </div>
</template>

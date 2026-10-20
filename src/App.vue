<script setup lang="ts">
import { listen } from "@tauri-apps/api/event";
import { isTauri } from "@tauri-apps/api/core";
import { onMounted } from "vue";
import { RouterLink, RouterView, useRouter } from "vue-router";
import { appVM } from "./viewmodels/appVM";
import { settingsVM } from "./viewmodels/settingsVM";
import { taskSheetVM } from "./viewmodels/taskSheetVM";
import { weekVM } from "./viewmodels/weekVM";
import SettingsModal from "./views/overlays/SettingsModal.vue";

const router = useRouter();

onMounted(async () => {
  await appVM.load();
  if (isTauri()) {
    await listen("capture:created", () => void weekVM.load());
    await listen("ai:enriched", () => void weekVM.load());
    await listen<string>("reminder:open", async (event) => {
      await router.push("/week");
      await taskSheetVM.open(event.payload);
    });
  }
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
      <button
        class="ml-auto text-[13px] text-base-content/35 hover:text-base-content/60"
        @click="settingsVM.open()"
      >
        ⚙
      </button>
    </header>
    <main class="mx-auto max-w-[980px] px-6 py-5">
      <RouterView />
    </main>
    <SettingsModal v-if="settingsVM.state.open" />
  </div>
</template>

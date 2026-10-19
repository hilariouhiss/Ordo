<script setup lang="ts">
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ref } from "vue";

const name = ref("Ordo");
const greeting = ref("在桌面应用中点击按钮，经 Rust 返回问候。");
const hasError = ref(false);

async function greet() {
  hasError.value = false;

  if (!isTauri()) {
    greeting.value = "浏览器预览：Tauri IPC 不可用。";
    return;
  }

  try {
    greeting.value = await invoke<string>("greet", { name: name.value });
  } catch (error) {
    hasError.value = true;
    greeting.value = "IPC 调用失败：" + String(error);
  }
}
</script>

<template>
  <main class="flex min-h-screen items-center justify-center bg-base-200 p-4 sm:p-8">
    <section class="card w-full max-w-md bg-base-100 shadow-xl">
      <div class="card-body gap-4">
        <h1 class="card-title text-2xl sm:text-3xl">Ordo</h1>
        <p class="text-base-content/70">Tauri 2 + Vue 3.6 + daisyUI</p>

        <label class="input w-full">
          <span class="label">名称</span>
          <input v-model="name" type="text" placeholder="Ordo" />
        </label>

        <div class="card-actions">
          <button type="button" class="btn btn-block" @click="greet">Greet from Rust</button>
        </div>

        <div role="alert" class="alert" :class="hasError ? 'alert-error' : 'alert-info'">
          <span>{{ greeting }}</span>
        </div>
      </div>
    </section>
  </main>
</template>

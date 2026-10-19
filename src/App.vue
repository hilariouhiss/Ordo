<script setup lang="ts">
import { invoke, isTauri } from "@tauri-apps/api/core";
import { ref } from "vue";

const name = ref("Ordo");
const greeting = ref("在桌面应用中点击按钮，经 Rust 返回问候。");

async function greet() {
  if (!isTauri()) {
    greeting.value = "浏览器预览：Tauri IPC 不可用。";
    return;
  }

  try {
    greeting.value = await invoke<string>("greet", { name: name.value });
  } catch (error) {
    greeting.value = "IPC 调用失败：" + String(error);
  }
}
</script>

<template>
  <section id="center">
    <h1>Ordo</h1>
    <p>Tauri 2 + Vue 3.6</p>
    <input v-model="name" aria-label="Name" />
    <button type="button" class="counter" @click="greet">Greet from Rust</button>
    <p>{{ greeting }}</p>
  </section>
</template>

<style scoped>
input {
  font: inherit;
  padding: 6px 10px;
  border: 1px solid var(--border);
  border-radius: 5px;
  background: var(--bg);
  color: var(--text-h);
}
</style>

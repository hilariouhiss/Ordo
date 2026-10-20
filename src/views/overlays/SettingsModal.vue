<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import * as ipc from "../../model/ipc";
import { appVM } from "../../viewmodels/appVM";
import { settingsVM as vm } from "../../viewmodels/settingsVM";

const settings = computed(() => appVM.state.settings);
const categoryName = ref("");
const tagName = ref("");
const recording = ref(false);
const pendingShortcut = ref("");
const shortcutWarning = ref("");
const keyDraft = ref("");
const aiStatus = ref("");

function startRecord(): void {
  pendingShortcut.value = "";
  recording.value = true;
}

function onKey(event: KeyboardEvent): void {
  if (!recording.value) return;
  event.preventDefault();
  if (event.key === "Escape") {
    recording.value = false;
    return;
  }
  if (["Control", "Alt", "Shift", "Meta"].includes(event.key)) return;
  const parts: string[] = [];
  if (event.ctrlKey) parts.push("Ctrl");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  if (event.metaKey) parts.push("Super");
  parts.push(event.key.length === 1 ? event.key.toUpperCase() : event.key);
  if (parts.length < 2) return;
  pendingShortcut.value = parts.join("+");
  recording.value = false;
}

async function saveKey(): Promise<void> {
  if (!keyDraft.value.trim()) return;
  await ipc.setAiKey(keyDraft.value.trim());
  keyDraft.value = "";
  aiStatus.value = "key 已保存";
  if (appVM.state.settings) appVM.state.settings.aiHasKey = true;
}

async function testAi(): Promise<void> {
  aiStatus.value = "测试中…";
  const result = await ipc.aiTest();
  aiStatus.value = result.ok
    ? `连接正常（${result.latencyMs}ms）`
    : `失败：${result.error ?? "未知错误"}`;
}

async function applyShortcut(): Promise<void> {
  if (!pendingShortcut.value) return;
  const outcome = await ipc.setShortcut(pendingShortcut.value);
  if (appVM.state.settings) appVM.state.settings.shortcut = outcome.active;
  shortcutWarning.value = outcome.warning ?? "";
  pendingShortcut.value = "";
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));

async function addCategory(): Promise<void> {
  await vm.addCategory(categoryName.value);
  categoryName.value = "";
}

async function addTag(): Promise<void> {
  await vm.addTag(tagName.value);
  tagName.value = "";
}
</script>

<template>
  <div
    class="fixed inset-0 z-40 flex items-center justify-center bg-neutral/40 p-4"
    @click.self="vm.close()"
  >
    <div
      class="max-h-[86vh] w-full max-w-[640px] overflow-y-auto rounded-2xl bg-base-100 p-5 shadow-2xl"
    >
      <div class="flex items-center">
        <h2 class="text-[15px] font-semibold">设置</h2>
        <button class="ml-auto text-base-content/30" @click="vm.close()">✕</button>
      </div>

      <div role="tablist" class="tabs tabs-border tabs-sm mt-3">
        <button
          role="tab"
          class="tab"
          :class="{ 'tab-active': vm.state.tab === 'ai' }"
          @click="vm.state.tab = 'ai'"
        >
          AI
        </button>
        <button
          role="tab"
          class="tab"
          :class="{ 'tab-active': vm.state.tab === 'general' }"
          @click="vm.state.tab = 'general'"
        >
          通用
        </button>
        <button
          role="tab"
          class="tab"
          :class="{ 'tab-active': vm.state.tab === 'data' }"
          @click="vm.state.tab = 'data'"
        >
          数据
        </button>
        <button
          role="tab"
          class="tab"
          :class="{ 'tab-active': vm.state.tab === 'meta' }"
          @click="vm.state.tab = 'meta'"
        >
          分类与标签
        </button>
      </div>

      <p v-if="vm.state.error" class="mt-2 text-[12px] text-error">{{ vm.state.error }}</p>

      <template v-if="settings">
        <div v-if="vm.state.tab === 'ai'" class="mt-4 rounded-xl bg-base-200 p-4">
          <div class="flex items-center gap-2">
            <span class="text-[12.5px] font-medium">DeepSeek</span>
            <span
              class="badge badge-soft badge-xs"
              :class="settings.aiEnabled ? 'badge-success' : 'badge-ghost'"
            >
              {{ settings.aiEnabled ? "开启" : "关闭" }}
            </span>
            <input
              type="checkbox"
              class="toggle toggle-sm toggle-success ml-auto"
              :checked="settings.aiEnabled"
              @change="vm.save({ aiEnabled: !settings.aiEnabled })"
            />
          </div>
          <div class="mt-3 space-y-2 text-[11.5px]">
            <label class="flex items-center gap-3">
              <span class="w-16 text-base-content/50">服务地址</span>
              <input
                class="input input-sm flex-1 rounded-lg border-base-300"
                :value="settings.aiBaseUrl"
                @change="vm.save({ aiBaseUrl: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label class="flex items-center gap-3">
              <span class="w-16 text-base-content/50">模型</span>
              <input
                class="input input-sm flex-1 rounded-lg border-base-300"
                :value="settings.aiModel"
                @change="vm.save({ aiModel: ($event.target as HTMLInputElement).value })"
              />
            </label>
            <label class="flex items-center gap-3">
              <span class="w-16 text-base-content/50">API key</span>
              <input
                v-model="keyDraft"
                type="password"
                class="input input-sm flex-1 rounded-lg border-base-300"
                :placeholder="settings.aiHasKey ? '已保存，输入新的可替换' : 'sk-…'"
              />
              <button
                class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
                @click="saveKey"
              >
                保存
              </button>
              <button
                class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
                @click="testAi"
              >
                测试
              </button>
            </label>
            <p v-if="aiStatus" class="text-[10.5px] text-base-content/45">{{ aiStatus }}</p>
          </div>
          <p class="mt-2 text-[10.5px] text-base-content/35">
            关掉后完全离线，捕获照样能用。key 存在 Windows 凭据管理器里，不进导出。
          </p>
        </div>

        <div v-else-if="vm.state.tab === 'general'" class="mt-4 rounded-xl bg-base-200 p-4">
          <div class="flex items-center justify-between text-[12px]">
            <span>开机自启</span>
            <input
              type="checkbox"
              class="toggle toggle-xs toggle-success"
              :checked="settings.autostart"
              @change="vm.save({ autostart: !settings.autostart })"
            />
          </div>
          <div class="mt-3 flex items-center justify-between text-[12px]">
            <span>全局快捷键</span>
            <span class="flex items-center gap-2">
              <span class="rounded-md bg-base-100 px-2 py-1 text-[11px] text-base-content/50">
                {{ recording ? "按下组合键…" : pendingShortcut || settings.shortcut }}
              </span>
              <button
                class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
                @click="startRecord"
              >
                改
              </button>
              <button
                v-if="pendingShortcut"
                class="btn btn-xs rounded-md border-0 bg-primary text-primary-content"
                @click="applyShortcut"
              >
                保存
              </button>
            </span>
          </div>
          <p v-if="shortcutWarning" class="mt-1 text-[10.5px] text-error">
            没换成：{{ shortcutWarning }}
          </p>
          <div class="mt-3 flex items-center justify-between text-[12px]">
            <span>周起点</span>
            <span class="text-[11px] text-base-content/40">周一</span>
          </div>
        </div>

        <div v-else-if="vm.state.tab === 'data'" class="mt-4 rounded-xl bg-base-200 p-4">
          <div class="flex items-center justify-between text-[12px]">
            <span>每日自动备份</span>
            <span class="text-[11px] text-base-content/40"
              >保留 {{ settings.backupKeepDays }} 天</span
            >
          </div>
          <div class="mt-3 flex items-center gap-2">
            <button
              class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
              @click="vm.backup"
            >
              立即备份
            </button>
            <button
              class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
              @click="vm.exportData"
            >
              导出 JSON
            </button>
          </div>
          <p v-if="vm.state.backupPath" class="mt-2 break-all text-[10.5px] text-base-content/40">
            备份：{{ vm.state.backupPath }}
          </p>
          <p v-if="vm.state.exportPath" class="mt-1 break-all text-[10.5px] text-base-content/40">
            导出：{{ vm.state.exportPath }}
          </p>
        </div>

        <div v-else class="mt-4 space-y-3">
          <div class="rounded-xl bg-base-200 p-4">
            <div class="text-[12px] font-medium">分类</div>
            <div class="mt-2 space-y-1">
              <div
                v-for="category in appVM.state.categories"
                :key="category.id"
                class="flex items-center gap-2 rounded-lg bg-base-100 px-3 py-1.5 text-[12px]"
              >
                <span class="flex-1">{{ category.name }}</span>
                <button class="text-base-content/30" @click="vm.moveCategory(category.id, -1)">
                  ↑
                </button>
                <button class="text-base-content/30" @click="vm.moveCategory(category.id, 1)">
                  ↓
                </button>
                <button class="text-base-content/30" @click="vm.removeCategory(category.id)">
                  ✕
                </button>
              </div>
            </div>
            <input
              v-model="categoryName"
              class="input input-sm mt-2 w-full rounded-lg border-dashed border-base-300 bg-transparent"
              placeholder="新增分类，回车保存"
              @keydown.enter="addCategory"
            />
          </div>

          <div class="rounded-xl bg-base-200 p-4">
            <div class="text-[12px] font-medium">标签</div>
            <div class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="tag in appVM.state.tags"
                :key="tag.id"
                class="badge badge-ghost badge-md gap-1.5"
              >
                {{ tag.name }}
                <button class="text-base-content/30" @click="vm.removeTag(tag.id)">✕</button>
              </span>
            </div>
            <input
              v-model="tagName"
              class="input input-sm mt-2 w-full rounded-lg border-dashed border-base-300 bg-transparent"
              placeholder="新增标签，回车保存"
              @keydown.enter="addTag"
            />
            <p class="mt-1.5 text-[10.5px] text-base-content/35">
              删除标签只影响显示，已经打过的任务不受影响。
            </p>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { errorText, t, type Language, type MessageKey } from "../../lib/i18n";
import { recordShortcut } from "../../lib/keys";
import { backdropMotion, modalPanelMotion, panelSwapMotion } from "../../lib/motion";
import type { ThemePref } from "../../lib/theme";
import * as ipc from "../../model/ipc";
import { appVM } from "../../viewmodels/appVM";
import { settingsVM as vm } from "../../viewmodels/settingsVM";

const themeOptions: { value: ThemePref; key: MessageKey }[] = [
  { value: "system", key: "settings.themeSystem" },
  { value: "light", key: "settings.themeLight" },
  { value: "dark", key: "settings.themeDark" },
];

// Each language names itself, so the switch reads from either side.
const languageOptions: { value: Language; label: string }[] = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

type AiStatus =
  | { kind: "saved" }
  | { kind: "testing" }
  | { kind: "ok"; ms: number }
  | { kind: "cleared" }
  | { kind: "failed"; error: string }
  | null;

const settings = computed(() => appVM.state.settings);
const recording = ref(false);
const pendingShortcut = ref("");
const shortcutWarning = ref("");
const keyDraft = ref("");
const hasKey = ref(false);
const aiStatus = ref<AiStatus>(null);
const aiStatusText = computed(() => {
  const status = aiStatus.value;
  if (!status) return "";
  if (status.kind === "saved") return t("settings.aiKeySaved");
  if (status.kind === "testing") return t("settings.aiTesting");
  if (status.kind === "cleared") return t("settings.aiKeyCleared");
  if (status.kind === "ok") return t("settings.aiOk", { ms: status.ms });
  return t("settings.aiFailed", { error: errorText(status.error) || t("settings.aiUnknown") });
});

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
  const combo = recordShortcut(event);
  if (!combo) return;
  pendingShortcut.value = combo;
  recording.value = false;
}

async function saveKey(): Promise<void> {
  if (!keyDraft.value.trim()) return;
  await ipc.setAiKey(keyDraft.value.trim());
  keyDraft.value = "";
  aiStatus.value = { kind: "saved" };
  hasKey.value = true;
}

async function clearKey(): Promise<void> {
  try {
    await ipc.clearAiKey();
    hasKey.value = false;
    keyDraft.value = "";
    aiStatus.value = { kind: "cleared" };
  } catch (e) {
    aiStatus.value = { kind: "failed", error: String(e) };
  }
}

/** A refused URL must not stay in the box as if it had been saved. */
async function saveBaseUrl(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  if (!(await vm.save({ aiBaseUrl: input.value }))) input.value = settings.value?.aiBaseUrl ?? "";
}

async function testAi(): Promise<void> {
  aiStatus.value = { kind: "testing" };
  try {
    const result = await ipc.aiTest();
    aiStatus.value = result.ok
      ? { kind: "ok", ms: result.latencyMs }
      : { kind: "failed", error: result.error ?? "" };
  } catch (e) {
    aiStatus.value = { kind: "failed", error: String(e) };
  }
}

async function applyShortcut(): Promise<void> {
  if (!pendingShortcut.value) return;
  const outcome = await ipc.setShortcut(pendingShortcut.value);
  if (appVM.state.settings) {
    appVM.state.settings.shortcut = outcome.active;
    appVM.state.settings.shortcutWarning = outcome.warning;
  }
  shortcutWarning.value = outcome.warning ?? "";
  pendingShortcut.value = "";
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  // The credential store is only read when this dialog opens, never on startup.
  void ipc
    .aiKeyStatus()
    .then((saved) => {
      hasKey.value = saved;
    })
    .catch(() => {});
});
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <motion.div
    v-bind="backdropMotion"
    class="fixed inset-0 z-40 flex items-center justify-center bg-neutral/40 p-4"
    @click.self="vm.close()"
  >
    <motion.div
      v-bind="modalPanelMotion"
      class="max-h-[86vh] w-full max-w-[640px] overflow-y-auto rounded-2xl bg-base-100 p-5 shadow-2xl"
    >
      <div class="flex items-center">
        <h2 class="text-[15px] font-semibold">{{ t("app.settingsTitle") }}</h2>
        <button
          class="ml-auto text-base-content/30"
          :aria-label="t('common.close')"
          @click="vm.close()"
        >
          <X :size="15" aria-hidden="true" />
        </button>
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
          {{ t("app.tabGeneral") }}
        </button>
        <button
          role="tab"
          class="tab"
          :class="{ 'tab-active': vm.state.tab === 'data' }"
          @click="vm.state.tab = 'data'"
        >
          {{ t("app.tabData") }}
        </button>
      </div>

      <p v-if="vm.state.error" class="mt-2 text-[12px] text-error">
        {{ errorText(vm.state.error) }}
      </p>

      <template v-if="settings">
        <AnimatePresence mode="wait" :initial="false">
          <motion.div :key="vm.state.tab" v-bind="panelSwapMotion">
            <div v-if="vm.state.tab === 'ai'" class="mt-4 rounded-xl bg-base-200 p-4">
              <div class="flex items-center gap-2">
                <span class="text-[12.5px] font-medium">DeepSeek</span>
                <span
                  class="badge badge-soft badge-xs"
                  :class="settings.aiEnabled ? 'badge-success' : 'badge-ghost'"
                >
                  {{ settings.aiEnabled ? t("settings.aiEnabledOn") : t("settings.aiEnabledOff") }}
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
                  <span
                    class="w-20 shrink-0 text-base-content/50"
                    v-text="t('settings.aiServiceUrl')"
                  ></span>
                  <input
                    class="input input-sm flex-1 rounded-lg border-base-300"
                    :value="settings.aiBaseUrl"
                    @change="saveBaseUrl"
                  />
                </label>
                <label class="flex items-center gap-3">
                  <span
                    class="w-20 shrink-0 text-base-content/50"
                    v-text="t('settings.aiModel')"
                  ></span>
                  <input
                    class="input input-sm flex-1 rounded-lg border-base-300"
                    :value="settings.aiModel"
                    @change="vm.save({ aiModel: ($event.target as HTMLInputElement).value })"
                  />
                </label>
                <label class="flex items-center gap-3">
                  <span
                    class="w-20 shrink-0 text-base-content/50"
                    v-text="t('settings.aiApiKey')"
                  ></span>
                  <input
                    v-model="keyDraft"
                    type="password"
                    class="input input-sm flex-1 rounded-lg border-base-300"
                    :placeholder="
                      hasKey ? t('settings.aiKeyPlaceholder') : t('settings.aiKeyPlaceholderEmpty')
                    "
                  />
                  <button
                    class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
                    @click="saveKey"
                  >
                    {{ t("common.save") }}
                  </button>
                  <button
                    class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
                    @click="testAi"
                  >
                    {{ t("settings.aiTest") }}
                  </button>
                  <button
                    v-if="hasKey"
                    class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
                    @click="clearKey"
                  >
                    {{ t("settings.aiKeyClear") }}
                  </button>
                </label>
                <p v-if="aiStatus" class="text-[10.5px] text-base-content/45">{{ aiStatusText }}</p>
              </div>
              <p class="mt-2 text-[10.5px] text-base-content/35">
                {{ t("settings.aiNote") }}
              </p>
            </div>

            <div v-else-if="vm.state.tab === 'general'" class="mt-4 rounded-xl bg-base-200 p-4">
              <div class="flex items-center justify-between text-[12px]">
                <span>{{ t("settings.theme") }}</span>
                <span class="flex gap-1.5">
                  <button
                    v-for="option in themeOptions"
                    :key="option.value"
                    class="btn btn-xs rounded-md border-base-300 font-normal"
                    :class="
                      settings.theme === option.value
                        ? 'border-0 bg-primary text-primary-content'
                        : 'bg-base-100'
                    "
                    @click="vm.save({ theme: option.value })"
                  >
                    {{ t(option.key) }}
                  </button>
                </span>
              </div>
              <div class="mt-3 flex items-center justify-between text-[12px]">
                <span>{{ t("settings.language") }}</span>
                <span class="flex gap-1.5">
                  <button
                    v-for="option in languageOptions"
                    :key="option.value"
                    class="btn btn-xs rounded-md border-base-300 font-normal"
                    :class="
                      settings.language === option.value
                        ? 'border-0 bg-primary text-primary-content'
                        : 'bg-base-100'
                    "
                    @click="vm.save({ language: option.value })"
                  >
                    {{ option.label }}
                  </button>
                </span>
              </div>
              <p class="mt-1 px-0.5 text-[10.5px] text-base-content/40">
                {{ t("settings.languageHint") }}
              </p>
              <div class="mt-3 flex items-center justify-between text-[12px]">
                <span>{{ t("settings.autostart") }}</span>
                <input
                  type="checkbox"
                  class="toggle toggle-xs toggle-success"
                  :checked="settings.autostart"
                  @change="vm.save({ autostart: !settings.autostart })"
                />
              </div>
              <div class="mt-3 flex items-center justify-between text-[12px]">
                <span>{{ t("settings.deskControls") }}</span>
                <input
                  type="checkbox"
                  class="toggle toggle-xs toggle-success"
                  :checked="settings.deskControls"
                  @change="vm.save({ deskControls: !settings.deskControls })"
                />
              </div>
              <p class="mt-1 px-0.5 text-[10.5px] text-base-content/40">
                {{ t("settings.deskControlsHint") }}
              </p>
              <div class="mt-3 flex items-center justify-between text-[12px]">
                <span>{{ t("settings.shortcut") }}</span>
                <span class="flex items-center gap-2">
                  <span class="rounded-md bg-base-100 px-2 py-1 text-[11px] text-base-content/50">
                    {{
                      recording
                        ? t("settings.shortcutRecording")
                        : pendingShortcut || settings.shortcut
                    }}
                  </span>
                  <button
                    class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
                    @click="startRecord"
                  >
                    {{ t("settings.shortcutChange") }}
                  </button>
                  <button
                    v-if="pendingShortcut"
                    class="btn btn-xs rounded-md border-0 bg-primary text-primary-content"
                    @click="applyShortcut"
                  >
                    {{ t("common.save") }}
                  </button>
                </span>
              </div>
              <p
                v-if="shortcutWarning || settings.shortcutWarning"
                class="mt-1 text-[10.5px] text-error"
              >
                {{
                  t("settings.shortcutWarning", {
                    error: errorText(shortcutWarning || settings.shortcutWarning || ""),
                  })
                }}
              </p>
              <div class="mt-3 flex items-center justify-between text-[12px]">
                <span>{{ t("settings.weekStart") }}</span>
                <span class="text-[11px] text-base-content/40">{{ t("settings.monday") }}</span>
              </div>
            </div>

            <div v-else-if="vm.state.tab === 'data'" class="mt-4 rounded-xl bg-base-200 p-4">
              <div class="flex items-center justify-between text-[12px]">
                <span>{{ t("settings.backupDaily") }}</span>
                <span class="text-[11px] text-base-content/40">
                  {{ t("settings.backupKeep", { days: settings.backupKeepDays }) }}
                </span>
              </div>
              <div class="mt-3 flex items-center gap-2">
                <button
                  class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
                  @click="vm.backup"
                >
                  {{ t("settings.backupNow") }}
                </button>
                <button
                  class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
                  @click="vm.exportData"
                >
                  {{ t("settings.exportJson") }}
                </button>
              </div>
              <p
                v-if="vm.state.backupPath"
                class="mt-2 break-all text-[10.5px] text-base-content/40"
              >
                {{ t("settings.backupPath", { path: vm.state.backupPath }) }}
              </p>
              <p
                v-if="vm.state.exportPath"
                class="mt-1 break-all text-[10.5px] text-base-content/40"
              >
                {{ t("settings.exportPath", { path: vm.state.exportPath }) }}
              </p>
              <p v-if="settings.backupError" class="mt-2 break-all text-[10.5px] text-error">
                {{ t("settings.backupError", { error: settings.backupError }) }}
              </p>
            </div>
          </motion.div>
        </AnimatePresence>
      </template>
    </motion.div>
  </motion.div>
</template>

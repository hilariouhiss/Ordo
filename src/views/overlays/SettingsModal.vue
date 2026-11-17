<script setup lang="ts">
import { Briefcase, House, X } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { errorText, t, type Language, type MessageKey } from "../../lib/i18n";
import { REMINDER_LEAD_MAX_MINUTES } from "../../lib/limits";
import { recordShortcut } from "../../lib/keys";
import { backdropMotion, modalPanelMotion, panelSwapMotion } from "../../lib/motion";
import type { ThemePref } from "../../lib/theme";
import * as ipc from "../../model/ipc";
import { appVM } from "../../viewmodels/appVM";
import { settingsVM as vm } from "../../viewmodels/settingsVM";
import { updateAction, updatesVM } from "../../viewmodels/updatesVM";
import type { PipelineEntry } from "../../viewmodels/requirementsVM";
import EffortField from "../components/EffortField.vue";
import StatusFlowEditor from "../components/StatusFlowEditor.vue";
import TimeField from "../components/TimeField.vue";

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

type ShortcutTarget = "capture" | "desk" | "main";

const settings = computed(() => appVM.state.settings);
/** The header and body are measured together, so switching tabs grows or shrinks the panel smoothly. */
const panelHeader = ref<HTMLElement | null>(null);
const panelContent = ref<HTMLElement | null>(null);
const panelHeight = ref("auto");
let panelObserver: ResizeObserver | null = null;

function measurePanel(): void {
  const header = panelHeader.value;
  const content = panelContent.value;
  if (!header || !content) return;
  const natural = header.offsetHeight + content.offsetHeight;
  panelHeight.value = `${Math.min(natural, Math.round(window.innerHeight * 0.86))}px`;
}

const recording = ref<ShortcutTarget | null>(null);
const pendingShortcut = ref<{ target: ShortcutTarget; combo: string } | null>(null);
const shortcutWarnings = ref<Partial<Record<ShortcutTarget, string>>>({});
/** The lead is edited in place, then saved; 0 is the field's empty state. */
const leadMinutes = ref(0);
watch(
  () => settings.value?.remindersLeadMinutes,
  (minutes) => {
    leadMinutes.value = minutes ?? 0;
  },
  { immediate: true },
);
function saveLead(minutes: number): void {
  const clamped = Math.min(REMINDER_LEAD_MAX_MINUTES, Math.max(0, Math.round(minutes)));
  leadMinutes.value = clamped;
  if (clamped !== settings.value?.remindersLeadMinutes) {
    void vm.save({ remindersLeadMinutes: clamped });
  }
}

/** The two schedule times are edited together, so one save keeps them a pair. */
const modeWorkAt = ref("09:00");
const modePersonalAt = ref("18:00");
watch(
  () => settings.value?.modeWorkAt,
  (value) => {
    modeWorkAt.value = value ?? "09:00";
  },
  { immediate: true },
);
watch(
  () => settings.value?.modePersonalAt,
  (value) => {
    modePersonalAt.value = value ?? "18:00";
  },
  { immediate: true },
);

const modeOptions = computed(() => [
  { value: "work" as const, label: t("mode.work"), icon: Briefcase },
  { value: "personal" as const, label: t("mode.personal"), icon: House },
]);

// The global template new projects copy; editing it never touches an existing project.
const requirementFlow = ref<PipelineEntry[]>([]);
const requirementFlowError = ref("");
const requirementFlowSaving = ref(false);
const requirementFlowLoaded = ref(false);

async function loadRequirementFlow(): Promise<void> {
  requirementFlowError.value = "";
  try {
    const names = await ipc.listDefaultRequirementStatuses();
    requirementFlow.value = names.map((name) => ({ id: null, name }));
    requirementFlowLoaded.value = true;
  } catch (e) {
    requirementFlowError.value = String(e);
  }
}

async function saveRequirementFlow(): Promise<void> {
  if (requirementFlow.value.some((row) => !row.name.trim())) {
    requirementFlowError.value = "empty_status_name";
    return;
  }
  requirementFlowSaving.value = true;
  requirementFlowError.value = "";
  try {
    const names = await ipc.saveDefaultRequirementStatuses(
      requirementFlow.value.map((row) => row.name.trim()),
    );
    requirementFlow.value = names.map((name) => ({ id: null, name }));
  } catch (e) {
    requirementFlowError.value = String(e);
  } finally {
    requirementFlowSaving.value = false;
  }
}

watch(
  () => vm.state.tab,
  (tab) => {
    if (tab === "requirement" && !requirementFlowLoaded.value) void loadRequirementFlow();
  },
  { immediate: true },
);

const MODE_DAY_KEYS: MessageKey[] = [
  "date.mon",
  "date.tue",
  "date.wed",
  "date.thu",
  "date.fri",
  "date.sat",
  "date.sun",
];
const modeDayOptions = computed(() =>
  MODE_DAY_KEYS.map((key, index) => ({ value: index + 1, label: t(key) })),
);

async function saveModeTimes(): Promise<void> {
  const current = settings.value;
  if (!current) return;
  if (modeWorkAt.value === current.modeWorkAt && modePersonalAt.value === current.modePersonalAt) {
    return;
  }
  if (
    !(await vm.save({
      modeWorkAt: modeWorkAt.value,
      modePersonalAt: modePersonalAt.value,
    }))
  ) {
    modeWorkAt.value = current.modeWorkAt;
    modePersonalAt.value = current.modePersonalAt;
  }
}

function toggleModeDay(day: number): void {
  const current = settings.value;
  if (!current) return;
  const next = current.modeDays.includes(day)
    ? current.modeDays.filter((value) => value !== day)
    : [...current.modeDays, day].sort((a, b) => a - b);
  if (!next.length) {
    vm.state.error = "invalid_mode_days";
    return;
  }
  vm.state.error = "";
  void vm.save({ modeDays: next });
}

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

const versionText = computed(() =>
  updatesVM.state.currentVersion ? `v${updatesVM.state.currentVersion}` : "—",
);
const updateBusy = computed(
  () =>
    updatesVM.state.phase === "checking" ||
    updatesVM.state.phase === "downloading" ||
    updatesVM.state.phase === "installing",
);
/** One line for the About row: what the last check found, or why it failed. */
/** The button offers the install as soon as a version is known; a failed check does not. */
const updateAvailable = computed(
  () => updateAction(updatesVM.state.phase, updatesVM.state.version !== null) === "install",
);
const updateLabel = computed(() => {
  switch (updatesVM.state.phase) {
    case "checking":
      return t("settings.checking");
    case "downloading":
      return t("settings.updateDownloading");
    case "installing":
      return t("settings.updateInstalling");
    default:
      return updateAvailable.value ? t("settings.updateNow") : t("settings.checkUpdate");
  }
});

/** One button: check while nothing is known, install once a version is. */
function runUpdateAction(): void {
  if (updateAvailable.value) void updatesVM.install();
  else void updatesVM.checkNow();
}

const updateStatus = computed(() => {
  const state = updatesVM.state;
  switch (state.phase) {
    case "checking":
      return t("settings.checking");
    case "failed":
      return t("settings.lastCheckFailed", { error: errorText(state.error ?? "") });
    case "available":
    case "downloading":
    case "installing":
    case "ready":
      return t("settings.updateFound", { version: state.version ?? "" });
    default:
      return state.checkedAt
        ? t("settings.upToDateAt", {
            time: new Date(state.checkedAt).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            }),
          })
        : "";
  }
});

const shortcutSetters = {
  capture: ipc.setShortcut,
  desk: ipc.setDeskShortcut,
  main: ipc.setMainShortcut,
};

const shortcutRows = computed(() => {
  const current = settings.value;
  return [
    {
      target: "capture" as const,
      label: t("settings.shortcut"),
      value: current?.shortcut ?? "",
      warning: current?.shortcutWarning ?? "",
    },
    {
      target: "desk" as const,
      label: t("settings.deskShortcut"),
      value: current?.deskShortcut ?? "",
      warning: current?.deskShortcutWarning ?? "",
    },
    {
      target: "main" as const,
      label: t("settings.mainShortcut"),
      value: current?.mainShortcut ?? "",
      warning: current?.mainShortcutWarning ?? "",
    },
  ];
});

function startRecord(target: ShortcutTarget): void {
  pendingShortcut.value = null;
  recording.value = target;
}

function onKey(event: KeyboardEvent): void {
  const target = recording.value;
  if (!target) return;
  event.preventDefault();
  if (event.key === "Escape") {
    recording.value = null;
    return;
  }
  const combo = recordShortcut(event);
  if (!combo) return;
  pendingShortcut.value = { target, combo };
  recording.value = null;
}

function displayShortcut(target: ShortcutTarget, value: string): string {
  if (recording.value === target) return t("settings.shortcutRecording");
  if (pendingShortcut.value?.target === target) return pendingShortcut.value.combo;
  return value;
}

function warningText(target: ShortcutTarget, stored: string): string {
  return shortcutWarnings.value[target] || stored;
}

async function saveKey(): Promise<void> {
  if (!keyDraft.value.trim()) return;
  // The Windows credential store can refuse (policy, locked vault); the button must say so
  // instead of looking dead.
  try {
    await ipc.setAiKey(keyDraft.value.trim());
    keyDraft.value = "";
    aiStatus.value = { kind: "saved" };
    hasKey.value = true;
  } catch (e) {
    aiStatus.value = { kind: "failed", error: String(e) };
  }
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
  const pending = pendingShortcut.value;
  if (!pending) return;
  const outcome = await shortcutSetters[pending.target](pending.combo);
  if (settings.value) {
    if (pending.target === "capture") {
      settings.value.shortcut = outcome.active;
      settings.value.shortcutWarning = outcome.warning;
    } else if (pending.target === "desk") {
      settings.value.deskShortcut = outcome.active;
      settings.value.deskShortcutWarning = outcome.warning;
    } else {
      settings.value.mainShortcut = outcome.active;
      settings.value.mainShortcutWarning = outcome.warning;
    }
  }
  shortcutWarnings.value[pending.target] = outcome.warning ?? "";
  pendingShortcut.value = null;
}

onMounted(() => {
  window.addEventListener("keydown", onKey);
  window.addEventListener("resize", measurePanel);
  panelObserver = new ResizeObserver(measurePanel);
  if (panelHeader.value) panelObserver.observe(panelHeader.value);
  if (panelContent.value) panelObserver.observe(panelContent.value);
  measurePanel();
  // The version is only shown here; reading it on open keeps startup lighter.
  void updatesVM.loadVersion();
  // The credential store is only read when this dialog opens, never on startup.
  void ipc
    .aiKeyStatus()
    .then((saved) => {
      hasKey.value = saved;
    })
    .catch(() => {});
});
onUnmounted(() => {
  window.removeEventListener("keydown", onKey);
  window.removeEventListener("resize", measurePanel);
  panelObserver?.disconnect();
});
</script>

<template>
  <motion.div
    v-bind="backdropMotion"
    class="window-scrim fixed inset-0 z-40 flex items-center justify-center bg-neutral/40 p-4"
    @click.self="vm.close()"
  >
    <motion.div v-bind="modalPanelMotion" class="w-full max-w-[680px]">
      <div
        class="flex max-h-[86vh] flex-col overflow-hidden rounded-2xl bg-base-100 shadow-2xl motion-safe:transition-[height] motion-safe:duration-200 motion-safe:ease-[cubic-bezier(0.22,1,0.36,1)]"
        :style="{ height: panelHeight }"
      >
        <div ref="panelHeader" class="shrink-0 px-5 pt-5">
          <div class="flex items-center">
            <h2 class="text-[17px] font-semibold">{{ t("app.settingsTitle") }}</h2>
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
              :class="{ 'tab-active': vm.state.tab === 'general' }"
              @click="vm.state.tab = 'general'"
            >
              {{ t("app.tabGeneral") }}
            </button>
            <button
              role="tab"
              class="tab"
              :class="{ 'tab-active': vm.state.tab === 'mode' }"
              @click="vm.state.tab = 'mode'"
            >
              {{ t("app.tabMode") }}
            </button>
            <button
              role="tab"
              class="tab"
              :class="{ 'tab-active': vm.state.tab === 'requirement' }"
              @click="vm.state.tab = 'requirement'"
            >
              {{ t("settings.tabRequirement") }}
            </button>
            <button
              role="tab"
              class="tab"
              :class="{ 'tab-active': vm.state.tab === 'data' }"
              @click="vm.state.tab = 'data'"
            >
              {{ t("app.tabData") }}
            </button>
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
              :class="{ 'tab-active': vm.state.tab === 'about' }"
              @click="vm.state.tab = 'about'"
            >
              {{ t("app.tabAbout") }}
            </button>
          </div>
        </div>

        <div class="min-h-0 overflow-y-auto">
          <div ref="panelContent" class="flow-root px-5 pb-5">
            <p v-if="vm.state.error" class="mt-2 text-[12px] text-error">
              {{ errorText(vm.state.error) }}
            </p>

            <template v-if="settings">
              <AnimatePresence mode="wait" :initial="false">
                <motion.div :key="vm.state.tab" v-bind="panelSwapMotion">
                  <div v-if="vm.state.tab === 'ai'" class="mt-4 rounded-xl bg-base-200 p-4">
                    <div class="flex items-center gap-2">
                      <span class="text-[13px] font-medium">DeepSeek</span>
                      <span
                        class="badge badge-soft badge-xs"
                        :class="settings.aiEnabled ? 'badge-success' : 'badge-ghost'"
                      >
                        {{
                          settings.aiEnabled
                            ? t("settings.aiEnabledOn")
                            : t("settings.aiEnabledOff")
                        }}
                      </span>
                      <input
                        type="checkbox"
                        class="toggle toggle-sm toggle-success ml-auto"
                        :checked="settings.aiEnabled"
                        @change="vm.save({ aiEnabled: !settings.aiEnabled })"
                      />
                    </div>
                    <div class="mt-3 space-y-2 text-[12px]">
                      <label class="flex items-center gap-3">
                        <span
                          class="w-20 shrink-0 text-base-content/65"
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
                          class="w-20 shrink-0 text-base-content/65"
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
                          class="w-20 shrink-0 text-base-content/65"
                          v-text="t('settings.aiApiKey')"
                        ></span>
                        <input
                          v-model="keyDraft"
                          type="password"
                          class="input input-sm flex-1 rounded-lg border-base-300"
                          :placeholder="
                            hasKey
                              ? t('settings.aiKeyPlaceholder')
                              : t('settings.aiKeyPlaceholderEmpty')
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
                      <p v-if="aiStatus" class="text-[12px] text-base-content/65">
                        {{ aiStatusText }}
                      </p>
                    </div>
                    <p class="mt-2 text-[12px] text-base-content/60">
                      {{ t("settings.aiNote") }}
                    </p>
                  </div>

                  <div v-else-if="vm.state.tab === 'mode'" class="mt-4 rounded-xl bg-base-200 p-4">
                    <div class="flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.modeCurrent") }}</span>
                      <span class="flex gap-1.5">
                        <button
                          v-for="option in modeOptions"
                          :key="option.value"
                          class="btn btn-xs rounded-md border-base-300 font-normal"
                          :class="
                            settings.mode === option.value
                              ? 'border-0 bg-base-content text-base-100'
                              : 'bg-base-100'
                          "
                          :aria-pressed="settings.mode === option.value"
                          @click="vm.switchMode(option.value)"
                        >
                          <component :is="option.icon" :size="12" aria-hidden="true" />
                          {{ option.label }}
                        </button>
                      </span>
                    </div>
                    <div class="mt-3 flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.modeAuto") }}</span>
                      <input
                        type="checkbox"
                        class="toggle toggle-xs toggle-success"
                        :checked="settings.modeAuto"
                        @change="vm.save({ modeAuto: !settings.modeAuto })"
                      />
                    </div>
                    <div class="mt-3 flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.modePersonalAt") }}</span>
                      <TimeField
                        v-model="modePersonalAt"
                        class="rounded-md border border-base-300 bg-base-100 px-2 py-1 text-[12px]"
                        :aria-label="t('settings.modePersonalAt')"
                        @update:model-value="saveModeTimes"
                      />
                    </div>
                    <div class="mt-3 flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.modeWorkAt") }}</span>
                      <TimeField
                        v-model="modeWorkAt"
                        class="rounded-md border border-base-300 bg-base-100 px-2 py-1 text-[12px]"
                        :aria-label="t('settings.modeWorkAt')"
                        @update:model-value="saveModeTimes"
                      />
                    </div>
                    <div class="mt-3 flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.modeDays") }}</span>
                      <span class="flex gap-1">
                        <button
                          v-for="day in modeDayOptions"
                          :key="day.value"
                          class="btn btn-xs rounded-md border-base-300 px-2 font-normal"
                          :class="
                            settings.modeDays.includes(day.value)
                              ? 'border-0 bg-base-content text-base-100'
                              : 'bg-base-100'
                          "
                          :aria-pressed="settings.modeDays.includes(day.value)"
                          @click="toggleModeDay(day.value)"
                        >
                          {{ day.label }}
                        </button>
                      </span>
                    </div>
                  </div>

                  <div
                    v-else-if="vm.state.tab === 'requirement'"
                    class="mt-4 rounded-xl bg-base-200 p-4"
                  >
                    <div class="flex items-center justify-between text-[12px]">
                      <span class="font-medium">{{ t("settings.requirementFlow") }}</span>
                      <span class="text-base-content/50">{{
                        t("settings.requirementFlowDefault")
                      }}</span>
                    </div>
                    <div class="mt-2 rounded-lg bg-base-100 p-3">
                      <StatusFlowEditor v-model="requirementFlow" />
                    </div>
                    <p class="mt-2 text-[11px] leading-5 text-base-content/50">
                      {{ t("settings.requirementFlowHint") }}
                    </p>
                    <p v-if="requirementFlowError" class="mt-1.5 text-[12px] text-error">
                      {{ errorText(requirementFlowError) }}
                    </p>
                    <div class="mt-3 flex justify-end gap-2">
                      <button
                        class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
                        @click="loadRequirementFlow"
                      >
                        {{ t("common.cancel") }}
                      </button>
                      <button
                        class="btn btn-xs rounded-md border-0 bg-base-content text-base-100"
                        :disabled="requirementFlowSaving"
                        @click="saveRequirementFlow"
                      >
                        {{ t("common.save") }}
                      </button>
                    </div>
                  </div>

                  <div
                    v-else-if="vm.state.tab === 'general'"
                    class="mt-4 rounded-xl bg-base-200 p-4"
                  >
                    <div class="flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.theme") }}</span>
                      <span class="flex gap-1.5">
                        <button
                          v-for="option in themeOptions"
                          :key="option.value"
                          class="btn btn-xs rounded-md border-base-300 font-normal"
                          :class="
                            settings.theme === option.value
                              ? 'border-0 bg-base-content text-base-100'
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
                              ? 'border-0 bg-base-content text-base-100'
                              : 'bg-base-100'
                          "
                          @click="vm.save({ language: option.value })"
                        >
                          {{ option.label }}
                        </button>
                      </span>
                    </div>
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
                    <div class="mt-3 flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.weekShowEmptyDays") }}</span>
                      <input
                        type="checkbox"
                        class="toggle toggle-xs toggle-success"
                        :checked="settings.weekShowEmptyDays"
                        @change="vm.save({ weekShowEmptyDays: !settings.weekShowEmptyDays })"
                      />
                    </div>
                    <div class="mt-3 flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.weekHideDone") }}</span>
                      <input
                        type="checkbox"
                        class="toggle toggle-xs toggle-success"
                        :checked="settings.weekHideDone"
                        @change="vm.save({ weekHideDone: !settings.weekHideDone })"
                      />
                    </div>
                    <div class="mt-3 flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.overdueRollover") }}</span>
                      <input
                        type="checkbox"
                        class="toggle toggle-xs toggle-success"
                        :checked="settings.overduePrompt"
                        @change="vm.save({ overduePrompt: !settings.overduePrompt })"
                      />
                    </div>
                    <div class="mt-4 h-px bg-base-300"></div>
                    <div class="mt-3 flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.reminderLead") }}</span>
                      <EffortField
                        v-model="leadMinutes"
                        compact
                        allow-zero
                        :label="t('settings.reminderLead')"
                        @update:model-value="saveLead"
                      />
                    </div>
                    <div class="mt-3 flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.digest") }}</span>
                      <input
                        type="checkbox"
                        class="toggle toggle-xs toggle-success"
                        :checked="settings.remindersDigest"
                        @change="vm.save({ remindersDigest: !settings.remindersDigest })"
                      />
                    </div>
                    <div v-for="row in shortcutRows" :key="row.target" class="mt-3">
                      <div class="flex items-center justify-between text-[12px]">
                        <span>{{ row.label }}</span>
                        <span class="flex items-center gap-2">
                          <span
                            class="rounded-md bg-base-100 px-2 py-1 text-[12px] text-base-content/65"
                          >
                            {{ displayShortcut(row.target, row.value) }}
                          </span>
                          <button
                            class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
                            @click="startRecord(row.target)"
                          >
                            {{ t("settings.shortcutChange") }}
                          </button>
                          <button
                            v-if="pendingShortcut?.target === row.target"
                            class="btn btn-xs rounded-md border-0 bg-base-content text-base-100"
                            @click="applyShortcut"
                          >
                            {{ t("common.save") }}
                          </button>
                        </span>
                      </div>
                      <p
                        v-if="warningText(row.target, row.warning)"
                        class="mt-1 text-[12px] text-error"
                      >
                        {{
                          t("settings.shortcutWarning", {
                            error: errorText(warningText(row.target, row.warning)),
                          })
                        }}
                      </p>
                    </div>
                  </div>

                  <div v-else-if="vm.state.tab === 'data'" class="mt-4 rounded-xl bg-base-200 p-4">
                    <div class="flex items-center justify-between text-[12px]">
                      <span>{{ t("settings.backupDaily") }}</span>
                      <span class="text-[12px] text-base-content/60">
                        {{ t("settings.backupKeep", { days: settings.backupKeepDays }) }}
                      </span>
                    </div>
                    <div class="mt-3 flex items-center gap-2">
                      <button
                        class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
                        :disabled="vm.state.busy"
                        @click="vm.backup"
                      >
                        {{ t("settings.backupNow") }}
                      </button>
                      <button
                        class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
                        :disabled="vm.state.busy"
                        @click="vm.exportData"
                      >
                        {{ t("settings.exportJson") }}
                      </button>
                    </div>
                    <p
                      v-if="vm.state.backupPath"
                      class="mt-2 break-all text-[12px] text-base-content/60"
                    >
                      {{ t("settings.backupPath", { path: vm.state.backupPath }) }}
                    </p>
                    <p
                      v-if="vm.state.exportPath"
                      class="mt-1 break-all text-[12px] text-base-content/60"
                    >
                      {{ t("settings.exportPath", { path: vm.state.exportPath }) }}
                    </p>
                    <p v-if="settings.backupError" class="mt-2 break-all text-[12px] text-error">
                      {{ t("settings.backupError", { error: settings.backupError }) }}
                    </p>
                  </div>

                  <div v-else-if="vm.state.tab === 'about'" class="mt-4 space-y-3">
                    <div class="rounded-xl bg-base-200 p-4">
                      <div class="flex items-center justify-between text-[12px]">
                        <span>{{ t("settings.version") }}</span>
                        <span class="text-base-content/60">{{ versionText }}</span>
                      </div>
                      <div class="mt-2 flex items-center justify-between text-[12px]">
                        <span class="text-base-content/60">{{ t("settings.appTagline") }}</span>
                        <span class="text-base-content/60">{{ t("settings.license") }}</span>
                      </div>
                    </div>
                    <div class="rounded-xl bg-base-200 p-4">
                      <div class="flex items-center justify-between text-[12px]">
                        <span>{{ t("settings.autoUpdateCheck") }}</span>
                        <input
                          type="checkbox"
                          class="toggle toggle-xs toggle-success"
                          :checked="settings.updatesAutoCheck"
                          @change="vm.save({ updatesAutoCheck: !settings.updatesAutoCheck })"
                        />
                      </div>
                      <div class="mt-3 flex items-center justify-between gap-2 text-[12px]">
                        <span
                          :class="
                            updatesVM.state.phase === 'failed'
                              ? 'text-error'
                              : 'text-base-content/60'
                          "
                        >
                          {{ updateStatus }}
                        </span>
                        <button
                          class="btn btn-xs rounded-md border-base-300 bg-base-100 font-normal"
                          :disabled="updateBusy"
                          @click="runUpdateAction"
                        >
                          {{ updateLabel }}
                        </button>
                      </div>
                    </div>
                  </div>
                </motion.div>
              </AnimatePresence>
            </template>
          </div>
        </div>
      </div>
    </motion.div>
  </motion.div>
</template>

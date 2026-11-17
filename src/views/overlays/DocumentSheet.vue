<script setup lang="ts">
import { X } from "@lucide/vue";
import { computed, onMounted, onUnmounted, ref } from "vue";
import { askConfirm } from "../../lib/dialog";
import { t } from "../../lib/i18n";
import { requirementsVM } from "../../viewmodels/requirementsVM";
import LinkPicker from "../components/LinkPicker.vue";

const document = computed(() => requirementsVM.state.document);
const section = computed(
  () =>
    document.value?.sections.find((item) => item.id === requirementsVM.state.selectedSectionId) ??
    null,
);
const body = ref<HTMLElement | null>(null);
const selectedText = ref("");
const popup = ref<{ top: number; left: number } | null>(null);
const pickerOpen = ref(false);

const requirementOptions = computed(() =>
  requirementsVM.state.requirements.map((requirement) => ({
    value: requirement.id,
    label: `${requirement.number} ${requirement.title}`,
  })),
);
const checkedRequirements = computed(
  () => section.value?.requirements.map((requirement) => requirement.id) ?? [],
);

function close(): void {
  requirementsVM.closeDocument();
}

function onMouseUp(): void {
  const selection = window.getSelection();
  const text = selection?.toString().trim() ?? "";
  if (
    !selection ||
    selection.rangeCount === 0 ||
    !text ||
    !body.value ||
    !body.value.contains(selection.anchorNode)
  ) {
    selectedText.value = "";
    popup.value = null;
    return;
  }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  selectedText.value = text;
  popup.value = {
    top: Math.min(rect.bottom + 6, window.innerHeight - 48),
    left: Math.min(rect.left, window.innerWidth - 120),
  };
}

function createRequirement(): void {
  const current = section.value;
  const text = selectedText.value.trim();
  if (!current || !text) return;
  const first =
    text
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "";
  void requirementsVM.createFromSection(current.id, first.slice(0, 80), text).then(() => {
    selectedText.value = "";
    popup.value = null;
    window.getSelection()?.removeAllRanges();
  });
}

function toggleRequirement(requirementId: string): void {
  const current = section.value;
  if (!current) return;
  if (checkedRequirements.value.includes(requirementId)) {
    void requirementsVM.unlinkSectionRequirement(current.id, requirementId);
  } else {
    void requirementsVM.linkSectionRequirement(current.id, requirementId);
  }
}

function focusRequirement(id: string): void {
  requirementsVM.closeDocument();
  requirementsVM.focus(id);
}

async function removeDocument(): Promise<void> {
  const current = document.value;
  if (!current) return;
  if (
    !(await askConfirm(
      t("requirements.deleteDocumentTitle"),
      t("requirements.deleteDocumentMessage", { title: current.title }),
    ))
  ) {
    return;
  }
  await requirementsVM.deleteDocument(current.id);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "Escape") close();
}
onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <Teleport v-if="document" to="body">
    <div
      class="window-scrim fixed inset-0 z-60 flex justify-end bg-neutral/40"
      @mousedown.left.self="close()"
    >
      <aside class="flex h-full w-full max-w-[760px] flex-col bg-base-100 shadow-2xl">
        <div class="flex items-center gap-2 border-b border-base-200 px-5 py-3">
          <div class="min-w-0">
            <div class="truncate text-[13px] font-semibold">{{ document.title }}</div>
            <div class="truncate text-[11px] text-base-content/50">
              {{ document.sourceName }} ·
              {{ t("requirements.documentChapters", { count: document.sections.length }) }}
            </div>
          </div>
          <button
            type="button"
            class="ml-auto text-[12px] text-base-content/60 hover:text-error"
            @click="removeDocument"
          >
            {{ t("common.delete") }}
          </button>
          <button
            type="button"
            class="text-base-content/30"
            :aria-label="t('documents.closeAria')"
            @click="close"
          >
            <X :size="15" aria-hidden="true" />
          </button>
        </div>
        <div class="flex min-h-0 flex-1">
          <nav
            class="w-[200px] shrink-0 overflow-y-auto border-r border-base-200 p-2"
            :aria-label="t('requirements.chapters')"
          >
            <button
              v-for="item in document.sections"
              :key="item.id"
              type="button"
              class="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px]"
              :class="
                item.id === requirementsVM.state.selectedSectionId
                  ? 'bg-base-200 text-base-content'
                  : 'text-base-content/70 hover:bg-base-200/60'
              "
              :style="{ paddingLeft: `${8 + Math.max(0, item.level - 1) * 10}px` }"
              @click="requirementsVM.selectSection(item.id)"
            >
              <span class="min-w-0 flex-1 truncate">{{ item.title }}</span>
            </button>
          </nav>
          <div v-if="section" class="flex min-w-0 flex-1 flex-col">
            <div class="flex items-center gap-2 border-b border-base-200 px-4 py-2">
              <span class="truncate text-[13px] font-medium">{{ section.title }}</span>
              <span class="ml-auto shrink-0 text-[11px] text-base-content/45">
                {{ t("documents.selectionHint") }}
              </span>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto px-4 py-3">
              <div class="relative flex flex-wrap items-center gap-1.5">
                <span class="mr-1 text-[11px] text-base-content/45">
                  {{ t("documents.linkedRequirements") }}
                </span>
                <span
                  v-for="requirement in section.requirements"
                  :key="requirement.id"
                  class="flex items-center gap-1 rounded-md border border-base-300 px-1.5 py-0.5 text-[11.5px]"
                >
                  <button
                    type="button"
                    class="max-w-56 truncate hover:text-primary"
                    @click="focusRequirement(requirement.id)"
                  >
                    {{ requirement.number }} {{ requirement.title }}
                  </button>
                  <button
                    type="button"
                    class="text-base-content/30 hover:text-error"
                    :aria-label="t('requirements.removeAria', { title: requirement.title })"
                    @click="toggleRequirement(requirement.id)"
                  >
                    <X :size="10" aria-hidden="true" />
                  </button>
                </span>
                <button
                  type="button"
                  class="px-1 text-[13px] text-base-content/50 hover:text-base-content"
                  :aria-label="t('documents.linkedRequirements')"
                  @click="pickerOpen = !pickerOpen"
                >
                  +
                </button>
                <LinkPicker
                  v-if="pickerOpen"
                  :options="requirementOptions"
                  :checked="checkedRequirements"
                  @toggle="toggleRequirement"
                  @close="pickerOpen = false"
                />
              </div>
              <div
                ref="body"
                class="mt-3 whitespace-pre-wrap text-[13px] leading-7 text-base-content/85 select-text"
                @mouseup="onMouseUp"
              >
                {{ section.body || t("documents.noText") }}
              </div>
            </div>
          </div>
          <div
            v-else
            class="flex flex-1 items-center justify-center text-[12px] text-base-content/50"
          >
            {{ t("documents.noSections") }}
          </div>
        </div>
      </aside>
      <button
        v-if="popup"
        type="button"
        class="btn btn-sm fixed z-[70] rounded-lg border-0 bg-base-content text-base-100 shadow-xl"
        :style="{ top: `${popup.top}px`, left: `${popup.left}px` }"
        @mousedown.prevent
        @click="createRequirement"
      >
        {{ t("documents.newRequirement") }}
      </button>
    </div>
  </Teleport>
</template>

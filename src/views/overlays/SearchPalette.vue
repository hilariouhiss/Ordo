<script setup lang="ts">
import { Folder, ListTodo, Search } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, nextTick, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { errorText, t, type MessageKey } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { backdropMotion, modalPanelMotion } from "../../lib/motion";
import type { SearchHit, SearchHitState } from "../../model/types";
import { archiveVM } from "../../viewmodels/archiveVM";
import { searchVM as vm } from "../../viewmodels/searchVM";
import { taskSheetVM } from "../../viewmodels/taskSheetVM";
import { windowModeVM } from "../../viewmodels/windowModeVM";

const router = useRouter();
const route = useRoute();
/** The pages that mount the task sheet; any other page has to hand off to the week. */
const SHEET_ROUTES = new Set(["week", "tasks", "templates", "project", "archive"]);
const input = ref<HTMLInputElement | null>(null);
const query = computed(() => vm.state.query.trim());
const stateKeys: Partial<Record<SearchHitState, MessageKey>> = {
  archived: "search.stateArchived",
  canceled: "search.stateCanceled",
  done: "search.stateDone",
};

watch(
  () => vm.state.open,
  async (open) => {
    if (!open) return;
    await nextTick();
    input.value?.focus();
  },
);

watch(
  () => vm.state.active,
  () => {
    void nextTick(() =>
      document
        .getElementById(`search-hit-${vm.state.active}`)
        ?.scrollIntoView({ block: "nearest" }),
    );
  },
);

function stateLabel(state: SearchHitState): string | null {
  const key = stateKeys[state];
  return key ? t(key) : null;
}

function onInput(event: Event): void {
  vm.setQuery((event.target as HTMLInputElement).value);
}

function onKey(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    vm.move(event.key === "ArrowDown" ? 1 : -1);
    return;
  }
  if (event.key !== "Enter" || isImeEnter(event)) return;
  event.preventDefault();
  void choose(vm.hitAt(vm.state.active));
}

/** A hit either opens the task sheet, the project page, or the archive tab it belongs to. */
async function choose(hit: SearchHit | null): Promise<void> {
  if (!hit) return;
  vm.close();
  await windowModeVM.ensureFull();
  if (hit.kind === "project") {
    await router.push(`/projects/${hit.id}`);
    return;
  }
  if (hit.state === "archived" || hit.state === "canceled") {
    archiveVM.state.tab = hit.state === "archived" ? "tasks" : "canceled";
    archiveVM.state.query = hit.title;
    await router.push("/archive");
    await archiveVM.load();
    return;
  }
  if (typeof route.name !== "string" || !SHEET_ROUTES.has(route.name)) {
    await router.push("/week");
  }
  await taskSheetVM.open(hit.id);
}
</script>

<template>
  <AnimatePresence>
    <motion.div
      v-if="vm.state.open"
      v-bind="backdropMotion"
      class="window-scrim fixed inset-0 z-[65] flex items-start justify-center bg-neutral/40 px-4 pt-[10vh]"
      @click.self="vm.close()"
      @keydown.esc="vm.close()"
    >
      <motion.div
        v-bind="modalPanelMotion"
        role="dialog"
        aria-modal="true"
        :aria-label="t('search.open')"
        class="w-full max-w-[620px] overflow-hidden rounded-2xl bg-base-100 shadow-2xl"
        @keydown.esc.stop="vm.close()"
      >
        <div class="flex items-center gap-2.5 border-b border-base-300 px-4 py-3">
          <Search :size="16" class="shrink-0 text-base-content/35" aria-hidden="true" />
          <input
            ref="input"
            :value="vm.state.query"
            class="min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-base-content/35"
            :placeholder="t('search.placeholder')"
            :aria-label="t('search.placeholder')"
            @input="onInput"
            @keydown="onKey"
          />
          <span class="badge badge-ghost badge-xs shrink-0">Esc</span>
        </div>

        <div
          class="max-h-[60vh] overflow-y-auto py-1.5"
          role="listbox"
          :aria-label="t('search.open')"
        >
          <p v-if="vm.state.error" class="px-6 py-8 text-center text-[12px] text-error">
            {{ errorText(vm.state.error) }}
          </p>
          <p
            v-else-if="!query"
            class="px-6 py-8 text-center text-[12px] leading-6 text-base-content/40"
          >
            {{ t("search.emptyHint") }}
          </p>
          <p
            v-else-if="vm.state.loading && !vm.state.hits.length"
            class="px-6 py-8 text-center text-base-content/40"
          >
            <span class="loading loading-spinner loading-xs"></span>
          </p>
          <p
            v-else-if="!vm.state.hits.length"
            class="px-6 py-8 text-center text-[12px] text-base-content/40"
          >
            {{ t("search.noResults", { query }) }}
          </p>
          <template v-else>
            <template v-for="(hit, index) in vm.state.hits" :key="`${hit.kind}-${hit.id}`">
              <div
                v-if="index === 0 || vm.state.hits[index - 1].kind !== hit.kind"
                class="px-4 pt-2 pb-1 text-[10.5px] tracking-wide text-base-content/40"
              >
                {{ hit.kind === "task" ? t("search.tasks") : t("search.projects") }}
              </div>
              <button
                :id="`search-hit-${index}`"
                type="button"
                role="option"
                :aria-selected="index === vm.state.active"
                class="flex w-full items-center gap-2.5 px-4 py-2 text-left"
                :class="index === vm.state.active ? 'bg-primary/10' : ''"
                @mouseenter="vm.state.active = index"
                @click="choose(hit)"
              >
                <ListTodo
                  v-if="hit.kind === 'task'"
                  :size="14"
                  class="shrink-0 text-base-content/35"
                  aria-hidden="true"
                />
                <Folder
                  v-else
                  :size="14"
                  class="shrink-0 text-base-content/35"
                  aria-hidden="true"
                />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-[12.5px]">{{ hit.title }}</span>
                  <span
                    v-if="hit.subtitle"
                    class="block truncate text-[10.5px] text-base-content/40"
                  >
                    {{ hit.subtitle }}
                  </span>
                </span>
                <span v-if="stateLabel(hit.state)" class="badge badge-ghost badge-xs shrink-0">
                  {{ stateLabel(hit.state) }}
                </span>
              </button>
            </template>
          </template>
        </div>

        <div
          class="flex items-center gap-3 border-t border-base-300 px-4 py-2 text-[10.5px] text-base-content/40"
        >
          <span>{{ t("search.footer") }}</span>
          <span class="badge badge-ghost badge-xs ml-auto">Ctrl K</span>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
</template>

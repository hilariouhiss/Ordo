<script setup lang="ts">
import { Trash } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, ref } from "vue";
import { askClient, askConfirm } from "../lib/dialog";
import { errorText, t } from "../lib/i18n";
import { isImeEnter } from "../lib/keys";
import { listItemMotion } from "../lib/motion";
import type { ProjectGroup } from "../model/types";
import { projectsVM } from "../viewmodels/projectsVM";

const name = ref("");
const error = ref("");

onMounted(() => {
  void projectsVM.load();
});

/** How many projects each 甲方 holds; the load already brought both lists in. */
const counts = computed(() => {
  const map = new Map<string, number>();
  for (const project of projectsVM.state.projects) {
    if (!project.groupId) continue;
    map.set(project.groupId, (map.get(project.groupId) ?? 0) + 1);
  }
  return map;
});

/** The contact line under the name; a 甲方 with neither field shows nothing extra. */
function contactLine(group: ProjectGroup): string {
  return [group.contact, group.phone].filter(Boolean).join(" · ");
}

async function add(): Promise<void> {
  if (!name.value.trim()) return;
  error.value = "";
  try {
    await projectsVM.createGroup(name.value);
    name.value = "";
  } catch (e) {
    error.value = String(e);
  }
}

function onKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void add();
}

/** The same dialog the other pages use for their 改 button; blank details become null. */
async function edit(group: ProjectGroup): Promise<void> {
  const draft = await askClient(t("clients.editTitle"), {
    name: group.name,
    contact: group.contact ?? "",
    phone: group.phone ?? "",
    note: group.note ?? "",
  });
  if (!draft) return;
  error.value = "";
  try {
    await projectsVM.updateClient(group.id, {
      name: draft.name,
      contact: draft.contact || null,
      phone: draft.phone || null,
      note: draft.note || null,
    });
  } catch (e) {
    error.value = String(e);
  }
}

async function remove(group: ProjectGroup): Promise<void> {
  if (
    !(await askConfirm(
      t("projects.deleteGroupTitle"),
      t("projects.deleteGroupMessage", { name: group.name }),
    ))
  )
    return;
  error.value = "";
  try {
    await projectsVM.removeGroup(group.id);
  } catch (e) {
    error.value = String(e);
  }
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">{{ t("clients.title") }}</h1>
      <span class="text-[11px] text-base-content/45">{{ t("clients.hint") }}</span>
    </div>

    <p v-if="error" class="px-1 text-[12px] text-error">{{ errorText(error) }}</p>

    <p
      v-if="!projectsVM.state.groups.length"
      class="rounded-xl bg-base-100 px-4 py-3 text-[12px] text-base-content/40"
    >
      {{ t("clients.empty") }}
    </p>

    <AnimatePresence as="ul" mode="popLayout" :initial="false" class="space-y-1.5">
      <motion.li
        v-for="group in projectsVM.state.groups"
        :key="group.id"
        v-bind="listItemMotion"
        class="flex items-center gap-3 rounded-xl bg-base-100 px-4 py-2.5 text-[12.5px]"
      >
        <div class="min-w-0 flex-1">
          <div class="flex items-baseline gap-2">
            <span>{{ group.name }}</span>
            <span v-if="contactLine(group)" class="text-[11px] text-base-content/45">
              {{ contactLine(group) }}
            </span>
          </div>
          <div
            v-if="group.note"
            class="mt-0.5 truncate text-[11px] text-base-content/40"
            :title="group.note"
          >
            {{ group.note }}
          </div>
        </div>
        <span class="shrink-0 text-[10.5px] tabular-nums text-base-content/35">
          {{ t("projects.groupCount", { count: counts.get(group.id) ?? 0 }) }}
        </span>
        <button class="shrink-0 text-base-content/35 hover:text-base-content" @click="edit(group)">
          {{ t("common.edit") }}
        </button>
        <button
          class="shrink-0 text-base-content/35 hover:text-error"
          :aria-label="t('projects.deleteGroupAria')"
          @click="remove(group)"
        >
          <Trash :size="14" aria-hidden="true" />
        </button>
      </motion.li>
    </AnimatePresence>

    <div class="flex items-center gap-2 rounded-xl bg-base-100 px-4 py-2.5">
      <input
        v-model="name"
        class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/40"
        :placeholder="t('clients.placeholder')"
        @keydown.enter="onKey"
      />
    </div>
    <p class="px-1 text-[10.5px] text-base-content/35">{{ t("clients.footer") }}</p>
  </section>
</template>

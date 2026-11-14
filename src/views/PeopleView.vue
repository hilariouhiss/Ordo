<script setup lang="ts">
import { Trash } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { ref } from "vue";
import { askConfirm, askPerson } from "../lib/dialog";
import { errorText, t } from "../lib/i18n";
import { isImeEnter } from "../lib/keys";
import { listItemMotion } from "../lib/motion";
import type { Person } from "../model/types";
import { appVM } from "../viewmodels/appVM";
import { metaVM } from "../viewmodels/metaVM";
import { usePageHeader } from "../viewmodels/pageHeaderVM";

const name = ref("");
const error = ref("");
usePageHeader(() => ({ title: t("people.title"), context: t("people.hint") }));

async function add(): Promise<void> {
  if (!name.value.trim()) return;
  error.value = "";
  try {
    await metaVM.addPerson(name.value);
    name.value = "";
  } catch (e) {
    error.value = String(e);
  }
}

function onKey(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  void add();
}

/** The categories this person covers, or a hint that none are set yet. */
function rolesLine(person: Person): string {
  const names = person.categoryIds.flatMap((id) => {
    const found = appVM.state.categories.find((category) => category.id === id);
    return found ? [found.name] : [];
  });
  return names.length ? t("people.rolesLine", { names: names.join(" · ") }) : t("people.rolesNone");
}

async function edit(person: Person): Promise<void> {
  const draft = await askPerson(t("people.editTitle"), {
    name: person.name,
    categoryIds: person.categoryIds,
  });
  if (!draft) return;
  error.value = "";
  try {
    await metaVM.updatePerson(person.id, draft.name, draft.categoryIds);
  } catch (e) {
    error.value = String(e);
  }
}

async function remove(person: Person): Promise<void> {
  if (
    !(await askConfirm(t("people.deleteTitle"), t("people.deleteMessage", { name: person.name })))
  )
    return;
  error.value = "";
  try {
    await metaVM.removePerson(person.id);
  } catch (e) {
    error.value = String(e);
  }
}
</script>

<template>
  <section class="space-y-2">
    <p v-if="error" class="px-1 text-[12px] text-error">{{ errorText(error) }}</p>

    <AnimatePresence as="ul" mode="popLayout" :initial="false" class="space-y-1.5">
      <motion.li
        v-for="person in appVM.state.people"
        :key="person.id"
        v-bind="listItemMotion"
        class="flex items-center gap-3 rounded-xl bg-base-100 px-4 py-2.5 text-[13px]"
      >
        <span>{{ person.name }}</span>
        <span v-if="person.isMe" class="badge badge-soft badge-primary badge-xs">{{
          t("people.me")
        }}</span>
        <span class="min-w-0 flex-1 truncate text-[12px] text-base-content/65">
          {{ rolesLine(person) }}
        </span>
        <button class="shrink-0 text-base-content/60 hover:text-base-content" @click="edit(person)">
          {{ t("common.edit") }}
        </button>
        <button
          v-if="!person.isMe"
          class="shrink-0 text-base-content/60 hover:text-error"
          :aria-label="t('people.deleteAria')"
          @click="remove(person)"
        >
          <Trash :size="14" aria-hidden="true" />
        </button>
      </motion.li>
    </AnimatePresence>

    <div class="flex items-center gap-2 rounded-xl bg-base-100 px-4 py-2.5">
      <input
        v-model="name"
        class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/60"
        :placeholder="t('people.placeholder')"
        @keydown.enter="onKey"
      />
    </div>
    <p class="px-1 text-[12px] text-base-content/60">
      {{ t("people.footer") }}
    </p>
  </section>
</template>

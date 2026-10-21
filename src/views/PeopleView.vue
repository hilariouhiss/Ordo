<script setup lang="ts">
import { Trash } from "@lucide/vue";
import { AnimatePresence, motion } from "motion-v";
import { ref } from "vue";
import { askConfirm, askText } from "../lib/dialog";
import { errorText, t } from "../lib/i18n";
import { isImeEnter } from "../lib/keys";
import { listItemMotion } from "../lib/motion";
import { appVM } from "../viewmodels/appVM";
import { metaVM } from "../viewmodels/metaVM";

const name = ref("");
const error = ref("");

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

async function rename(id: string, current: string): Promise<void> {
  const next = await askText(t("people.editTitle"), current);
  if (!next) return;
  error.value = "";
  try {
    await metaVM.renamePerson(id, next);
  } catch (e) {
    error.value = String(e);
  }
}

async function remove(id: string, personName: string): Promise<void> {
  if (!(await askConfirm(t("people.deleteTitle"), t("people.deleteMessage", { name: personName }))))
    return;
  error.value = "";
  try {
    await metaVM.removePerson(id);
  } catch (e) {
    error.value = String(e);
  }
}
</script>

<template>
  <section class="space-y-2">
    <div class="flex items-center gap-3">
      <h1 class="text-[16px] font-semibold">{{ t("people.title") }}</h1>
      <span class="text-[11px] text-base-content/45">{{ t("people.hint") }}</span>
    </div>

    <p v-if="error" class="px-1 text-[12px] text-error">{{ errorText(error) }}</p>

    <AnimatePresence as="ul" mode="popLayout" :initial="false" class="space-y-1.5">
      <motion.li
        v-for="person in appVM.state.people"
        :key="person.id"
        v-bind="listItemMotion"
        class="flex items-center gap-3 rounded-xl bg-base-100 px-4 py-2.5 text-[12.5px]"
      >
        <span>{{ person.name }}</span>
        <span v-if="person.isMe" class="badge badge-soft badge-primary badge-xs">{{
          t("people.me")
        }}</span>
        <button
          class="ml-auto text-base-content/35 hover:text-base-content"
          @click="rename(person.id, person.name)"
        >
          {{ t("common.edit") }}
        </button>
        <button
          v-if="!person.isMe"
          class="text-base-content/35 hover:text-error"
          :aria-label="t('people.deleteAria')"
          @click="remove(person.id, person.name)"
        >
          <Trash :size="14" aria-hidden="true" />
        </button>
      </motion.li>
    </AnimatePresence>

    <div class="flex items-center gap-2 rounded-xl bg-base-100 px-4 py-2.5">
      <input
        v-model="name"
        class="w-full bg-transparent text-[13px] outline-none placeholder:text-base-content/40"
        :placeholder="t('people.placeholder')"
        @keydown.enter="onKey"
      />
    </div>
    <p class="px-1 text-[10.5px] text-base-content/35">
      {{ t("people.footer") }}
    </p>
  </section>
</template>

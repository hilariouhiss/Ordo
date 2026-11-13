<script setup lang="ts">
import { AnimatePresence, motion } from "motion-v";
import { nextTick, reactive, ref, watch } from "vue";
import { shortDate, todayIso } from "../../lib/dates";
import { closeDialog, dialogRequest } from "../../lib/dialog";
import { t } from "../../lib/i18n";
import { isImeEnter } from "../../lib/keys";
import { backdropMotion, modalPanelMotion } from "../../lib/motion";
import { overdueDays } from "../../model/mappers";
import { appVM } from "../../viewmodels/appVM";
import DateField from "../components/DateField.vue";

const draft = ref("");
const reasonDraft = ref("");
const untilDraft = ref("");
const deferDate = ref("");
const deferReason = ref("");
const deferDates = reactive<Record<string, string>>({});
const waitPerson = ref("");
const waitDate = ref("");
const client = reactive({ name: "", contact: "", phone: "", note: "" });
const person = reactive({ name: "", categoryIds: [] as string[] });
const textInput = ref<HTMLInputElement | null>(null);
const clientNameInput = ref<HTMLInputElement | null>(null);
const personNameInput = ref<HTMLInputElement | null>(null);
const reasonInput = ref<HTMLInputElement | null>(null);
const confirmButton = ref<HTMLButtonElement | null>(null);
const futureButton = ref<HTMLButtonElement | null>(null);

watch(dialogRequest, async (request) => {
  if (!request) return;
  await nextTick();
  if (request.kind === "text") {
    draft.value = request.value;
    await nextTick();
    textInput.value?.select();
  } else if (request.kind === "suspend") {
    reasonDraft.value = "";
    untilDraft.value = "";
    await nextTick();
    reasonInput.value?.focus();
  } else if (request.kind === "waiting") {
    waitPerson.value = request.personId ?? "";
    waitDate.value = request.followUpDate;
    await nextTick();
    confirmButton.value?.focus();
  } else if (request.kind === "defer") {
    deferDate.value = request.finish;
    deferReason.value = "";
    await nextTick();
    confirmButton.value?.focus();
  } else if (request.kind === "overdue") {
    for (const task of request.tasks) deferDates[task.id] = request.finish;
    deferReason.value = "";
    await nextTick();
    confirmButton.value?.focus();
  } else if (request.kind === "client") {
    client.name = request.name;
    client.contact = request.contact;
    client.phone = request.phone;
    client.note = request.note;
    await nextTick();
    clientNameInput.value?.select();
  } else if (request.kind === "person") {
    person.name = request.name;
    person.categoryIds = [...request.categoryIds];
    await nextTick();
    personNameInput.value?.select();
  } else if (request.kind === "taskDefault") {
    await nextTick();
    futureButton.value?.focus();
  } else {
    confirmButton.value?.focus();
  }
});

function confirm(): void {
  const request = dialogRequest.value;
  if (!request) return;
  if (request.kind === "confirm") {
    closeDialog("ok");
    return;
  }
  if (request.kind === "notice") {
    closeDialog(null);
    return;
  }
  if (request.kind === "suspend") {
    closeDialog({ reason: reasonDraft.value.trim(), until: untilDraft.value });
    return;
  }
  if (request.kind === "waiting") {
    closeDialog({ personId: waitPerson.value || null, followUpDate: waitDate.value });
    return;
  }
  if (request.kind === "defer") {
    if (!deferDate.value) return;
    closeDialog({ finish: deferDate.value, reason: deferReason.value.trim() });
    return;
  }
  if (request.kind === "overdue") {
    closeDialog({
      dates: request.tasks.map((task) => ({
        id: task.id,
        finish: deferDates[task.id] || request.finish,
      })),
      reason: deferReason.value.trim(),
    });
    return;
  }
  if (request.kind === "client") {
    const name = client.name.trim();
    if (!name) return;
    closeDialog({
      name,
      contact: client.contact.trim(),
      phone: client.phone.trim(),
      note: client.note.trim(),
    });
    return;
  }
  if (request.kind === "person") {
    const name = person.name.trim();
    if (!name) return;
    closeDialog({ name, categoryIds: [...person.categoryIds] });
    return;
  }
  const value = draft.value.trim();
  if (!value) return;
  closeDialog(value);
}

function onEnter(event: KeyboardEvent): void {
  if (isImeEnter(event)) return;
  confirm();
}
</script>

<template>
  <AnimatePresence>
    <motion.div
      v-if="dialogRequest"
      v-bind="backdropMotion"
      class="window-scrim fixed inset-0 z-70 flex items-center justify-center bg-neutral/40 p-4"
      @click.self="closeDialog(null)"
      @keydown.esc="closeDialog(null)"
    >
      <motion.div
        v-bind="modalPanelMotion"
        role="dialog"
        aria-modal="true"
        :aria-label="dialogRequest.title"
        class="flex max-h-[86vh] w-full flex-col overflow-hidden rounded-2xl bg-base-100 shadow-2xl"
        :class="dialogRequest.kind === 'overdue' ? 'max-w-[460px]' : 'max-w-[340px]'"
      >
        <h2 class="shrink-0 px-5 pt-5 text-[15px] font-semibold">{{ dialogRequest.title }}</h2>
        <div class="min-h-0 overflow-y-auto px-5 pb-5">
          <template v-if="dialogRequest.kind === 'suspend'">
            <label class="mt-3 block text-[11px] text-base-content/45">
              {{ t("task.suspendReasonLabel") }}
              <input
                ref="reasonInput"
                v-model="reasonDraft"
                class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
                :placeholder="t('task.suspendReasonPlaceholder')"
                @keydown.enter="onEnter"
              />
            </label>
            <label class="mt-2 block text-[11px] text-base-content/45">
              {{ t("task.suspendUntilLabel") }}
              <DateField
                v-model="untilDraft"
                :min="todayIso()"
                :aria-label="t('task.suspendUntilLabel')"
                class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
                @enter="confirm"
              />
            </label>
          </template>
          <template v-else-if="dialogRequest.kind === 'waiting'">
            <label class="mt-3 block text-[11px] text-base-content/45">
              {{ t("task.waitingOnLabel") }}
              <select
                v-model="waitPerson"
                class="select select-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
              >
                <option value="">{{ t("task.waitingOnNone") }}</option>
                <option v-for="person in appVM.state.people" :key="person.id" :value="person.id">
                  {{ person.name }}
                </option>
              </select>
            </label>
            <label class="mt-2 block text-[11px] text-base-content/45">
              {{ t("task.followUpLabel") }}
              <DateField
                v-model="waitDate"
                :min="todayIso()"
                :aria-label="t('task.followUpLabel')"
                class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
                @enter="confirm"
              />
            </label>
            <p class="mt-2 text-[10.5px] leading-relaxed text-base-content/45">
              {{ t("task.waitingHint") }}
            </p>
          </template>
          <template v-else-if="dialogRequest.kind === 'defer'">
            <label class="mt-3 block text-[11px] text-base-content/45">
              {{ t("task.deferFinishLabel") }}
              <DateField
                v-model="deferDate"
                :min="dialogRequest.min"
                :aria-label="t('task.deferFinishLabel')"
                class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
                @enter="confirm"
              />
            </label>
            <label class="mt-2 block text-[11px] text-base-content/45">
              {{ t("task.deferReasonLabel") }}
              <input
                v-model="deferReason"
                class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
                :placeholder="t('task.deferReasonPlaceholder')"
                @keydown.enter="onEnter"
              />
            </label>
            <p class="mt-2 text-[10.5px] leading-relaxed text-base-content/45">
              {{ t("task.deferHint") }}
              <span v-if="deferDate" class="mt-0.5 block">{{
                t("task.deferRecordHint", {
                  from: shortDate(dialogRequest.oldFinish),
                  to: shortDate(deferDate),
                })
              }}</span>
            </p>
          </template>
          <template v-else-if="dialogRequest.kind === 'overdue'">
            <ul
              class="mt-3 max-h-[46vh] divide-y divide-base-300 overflow-y-auto rounded-lg border border-base-300"
            >
              <li
                v-for="task in dialogRequest.tasks"
                :key="task.id"
                class="flex items-center gap-2 px-2.5 py-1.5"
              >
                <span class="min-w-0 flex-1 truncate text-[12.5px]">{{ task.title }}</span>
                <span class="shrink-0 text-[10.5px] text-error">{{
                  t("task.overdue", { days: overdueDays(task.expectedFinishDate, todayIso()) })
                }}</span>
                <DateField
                  v-model="deferDates[task.id]"
                  :min="dialogRequest.min"
                  :aria-label="t('task.deferFinishLabel')"
                  class="input input-sm h-8 w-[132px] shrink-0 rounded-lg border-base-300 text-[12px]"
                  @enter="confirm"
                />
              </li>
            </ul>
            <label class="mt-3 block text-[11px] text-base-content/45">
              {{ t("task.deferReasonLabel") }}
              <input
                v-model="deferReason"
                class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
                :placeholder="t('task.deferReasonPlaceholder')"
                @keydown.enter="onEnter"
              />
            </label>
            <p class="mt-2 text-[10.5px] leading-relaxed text-base-content/45">
              {{ t("overdue.batchHint", { date: shortDate(dialogRequest.finish) }) }}
            </p>
          </template>
          <template v-else-if="dialogRequest.kind === 'person'">
            <label class="mt-3 block text-[11px] text-base-content/45">
              {{ t("people.name") }}
              <input
                ref="personNameInput"
                v-model="person.name"
                class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
                @keydown.enter="onEnter"
              />
            </label>
            <div class="mt-3 text-[11px] text-base-content/45">
              {{ t("people.roles") }}
              <div class="mt-1 grid grid-cols-2 gap-1">
                <label
                  v-for="category in appVM.state.categories"
                  :key="category.id"
                  class="flex cursor-pointer items-center gap-1.5 rounded-md px-1.5 py-1 text-[12.5px]"
                  :class="
                    person.categoryIds.includes(category.id)
                      ? 'bg-primary/5 text-primary'
                      : 'text-base-content/70'
                  "
                >
                  <input
                    v-model="person.categoryIds"
                    type="checkbox"
                    class="checkbox checkbox-xs"
                    :value="category.id"
                  />
                  {{ category.name }}
                </label>
              </div>
            </div>
            <p class="mt-2 text-[10.5px] leading-relaxed text-base-content/45">
              {{ t("people.rolesHint") }}
            </p>
          </template>
          <template v-else-if="dialogRequest.kind === 'client'">
            <label class="mt-3 block text-[11px] text-base-content/45">
              {{ t("clients.name") }}
              <input
                ref="clientNameInput"
                v-model="client.name"
                class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
                @keydown.enter="onEnter"
              />
            </label>
            <label class="mt-2 block text-[11px] text-base-content/45">
              {{ t("clients.contact") }}
              <input
                v-model="client.contact"
                class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
                @keydown.enter="onEnter"
              />
            </label>
            <label class="mt-2 block text-[11px] text-base-content/45">
              {{ t("clients.phone") }}
              <input
                v-model="client.phone"
                class="input input-sm mt-1 w-full rounded-lg border-base-300 text-[12.5px]"
                @keydown.enter="onEnter"
              />
            </label>
            <label class="mt-2 block text-[11px] text-base-content/45">
              {{ t("clients.note") }}
              <textarea
                v-model="client.note"
                rows="2"
                class="textarea mt-1 w-full resize-none rounded-lg border-base-300 text-[12.5px]"
              ></textarea>
            </label>
          </template>
          <input
            v-else-if="dialogRequest.kind === 'text'"
            ref="textInput"
            v-model="draft"
            class="input input-sm mt-3 w-full rounded-lg border-base-300 text-[12.5px]"
            @keydown.enter="onEnter"
          />
          <p v-else class="mt-2 text-[12.5px] leading-relaxed text-base-content/60">
            {{ dialogRequest.message }}
          </p>

          <div class="mt-5 flex justify-end gap-2">
            <template v-if="dialogRequest.kind === 'taskDefault'">
              <button
                class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
                @click="closeDialog(null)"
              >
                {{ t("dialog.cancel") }}
              </button>
              <button
                ref="futureButton"
                class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
                @click="closeDialog('future')"
              >
                {{ t("settings.taskDefaultFutureOnly") }}
              </button>
              <button
                class="btn btn-sm rounded-lg border-0 bg-primary text-primary-content"
                @click="closeDialog('existing')"
              >
                {{ t("settings.taskDefaultExisting") }}
              </button>
            </template>
            <template v-else>
              <button
                v-if="dialogRequest.kind !== 'notice'"
                class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
                @click="closeDialog(null)"
              >
                {{
                  dialogRequest.kind === "overdue" ? t("overdue.defaultAction") : t("dialog.cancel")
                }}
              </button>
              <button
                ref="confirmButton"
                class="btn btn-sm rounded-lg border-0"
                :class="
                  dialogRequest.kind === 'confirm'
                    ? 'bg-error text-error-content'
                    : 'bg-primary text-primary-content'
                "
                @click="confirm"
              >
                {{
                  t(
                    dialogRequest.kind === "notice"
                      ? "dialog.dismiss"
                      : dialogRequest.kind === "client" || dialogRequest.kind === "person"
                        ? "common.save"
                        : dialogRequest.kind === "overdue"
                          ? "overdue.deferAll"
                          : "dialog.ok",
                  )
                }}
              </button>
            </template>
          </div>
        </div>
      </motion.div>
    </motion.div>
  </AnimatePresence>
</template>

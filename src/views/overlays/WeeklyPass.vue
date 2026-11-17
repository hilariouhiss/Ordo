<script setup lang="ts">
import { AnimatePresence, motion } from "motion-v";
import { computed, onMounted, onUnmounted } from "vue";
import { shortDate, todayIso } from "../../lib/dates";
import { askPark, dialogRequest, runWithNotice } from "../../lib/dialog";
import { t } from "../../lib/i18n";
import { backdropMotion, passCardMotion, screenColumnMotion } from "../../lib/motion";
import { parkDefaults } from "../../lib/park";
import { canParkTask } from "../../lib/status";
import { appVM } from "../../viewmodels/appVM";
import { passVM } from "../../viewmodels/passVM";
import { taskSheetVM } from "../../viewmodels/taskSheetVM";
import { weekVM } from "../../viewmodels/weekVM";

const finished = computed(() => passVM.state.queue.length > 0 && !passVM.current.value);
/** A parked card has already left this pass; a done one cannot be parked. */
const canParkCurrent = computed(() => {
  const task = passVM.current.value;
  return task ? canParkTask(task) && !task.parked : false;
});
const categoryName = computed(() => {
  const id = passVM.current.value?.categoryId;
  return appVM.state.categories.find((c) => c.id === id)?.name;
});
const projectName = computed(() => {
  const id = passVM.current.value?.projectId;
  return appVM.state.projects.find((p) => p.id === id)?.name;
});
const ownerName = computed(() => {
  const id = passVM.current.value?.ownerId;
  return appVM.state.people.find((p) => p.id === id)?.name;
});

async function act(action: "keep" | "done" | "cancel"): Promise<void> {
  await runWithNotice(() => passVM.resolve(action));
}

/** The same park dialog the rows use; a confirmed park advances the card. */
async function actPark(): Promise<void> {
  const task = passVM.current.value;
  if (!task || !canParkCurrent.value || passVM.state.busy) return;
  const draft = await askPark(t("task.suspendAria", { title: task.title }), {
    reason: "",
    ...parkDefaults(task, appVM.state.people, todayIso()),
  });
  if (!draft) return;
  await runWithNotice(() =>
    passVM.resolve("park", draft.until || null, draft.reason || null, draft.personId),
  );
}

async function finish(): Promise<void> {
  if (!(await runWithNotice(() => passVM.finish()))) return;
  await weekVM.load();
}

function split(): void {
  const card = passVM.splitCurrent();
  if (card) void taskSheetVM.open(card.id);
}

function onKey(event: KeyboardEvent): void {
  if (!passVM.state.open) return;
  // A notice opened by a failed action owns the keyboard until it is dismissed.
  if (dialogRequest.value) return;
  // While the task sheet is open it owns the keyboard; its own Escape closes just it.
  if (taskSheetVM.state.openId) return;

  if (event.key === "Escape") {
    // On the summary card Escape does what its only button does.
    if (finished.value) void finish();
    else passVM.close();
    return;
  }
  if (finished.value) return;
  if (event.repeat) return;

  // Let focused inputs and buttons handle their own Enter/Space.
  const target = event.target;
  if (target instanceof HTMLElement && target.closest("input, select, textarea, button, a")) {
    return;
  }

  if (event.key === "Enter") return void act("keep");
  if (event.key.toLowerCase() === "d") return void act("done");
  if (event.key.toLowerCase() === "x") return void act("cancel");
  if (event.key.toLowerCase() === "s" && canParkCurrent.value) void actPark();
  if (event.key.toLowerCase() === "e") split();
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <motion.div
    v-bind="backdropMotion"
    class="window-scrim fixed inset-0 z-50 overflow-y-auto bg-neutral/92 p-6 text-neutral-content"
  >
    <motion.div v-bind="screenColumnMotion" class="mx-auto max-w-[720px]">
      <div class="flex items-center gap-3 text-[12px]">
        <span class="font-medium">{{ t("pass.title") }}</span>
        <span class="opacity-50">{{ t("pass.subtitle") }}</span>
        <span class="ml-auto tabular-nums opacity-70">
          {{ Math.min(passVM.state.index + 1, passVM.state.queue.length) }} /
          {{ passVM.state.queue.length }}
        </span>
      </div>

      <AnimatePresence mode="popLayout" :initial="false">
        <motion.div
          v-if="passVM.current.value"
          :key="passVM.current.value.id"
          v-bind="passCardMotion"
          layout
          class="mt-5 rounded-2xl bg-base-100 p-6 text-base-content"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span
              v-if="passVM.current.value.carryCount"
              class="badge badge-soft badge-warning badge-sm"
            >
              {{ t("pass.carry", { count: passVM.current.value.carryCount }) }}
            </span>
            <span v-if="projectName" class="badge badge-ghost badge-sm">{{ projectName }}</span>
            <span v-if="categoryName" class="badge badge-ghost badge-sm">{{ categoryName }}</span>
            <span class="text-[12px] text-base-content/65">
              {{
                t("pass.due", {
                  owner: ownerName || "",
                  date: shortDate(passVM.current.value.expectedFinishDate) || t("pass.noDue"),
                })
              }}
            </span>
          </div>

          <h2 class="mt-3 text-[22px] font-semibold tracking-tight">
            {{ passVM.current.value.title }}
          </h2>

          <p
            v-if="passVM.current.value.carryCount >= 3"
            class="mt-4 rounded-lg bg-warning/10 px-3 py-2 text-[12px] text-warning"
          >
            {{ t("pass.warning", { count: passVM.current.value.carryCount }) }}
          </p>

          <div class="mt-5 flex flex-wrap items-center gap-2">
            <button
              class="btn rounded-lg border-0 bg-primary px-5 text-primary-content"
              @click="act('keep')"
            >
              {{ t("pass.keep") }} <kbd class="kbd kbd-xs ml-1">⏎</kbd>
            </button>
            <button
              class="btn rounded-lg border-base-300 bg-base-100 font-normal"
              @click="act('done')"
            >
              {{ t("pass.done") }} <kbd class="kbd kbd-xs ml-1">D</kbd>
            </button>
            <button class="btn rounded-lg border-base-300 bg-base-100 font-normal" @click="split">
              {{ t("pass.split") }} <kbd class="kbd kbd-xs ml-1">E</kbd>
            </button>
            <button
              v-if="canParkCurrent"
              class="btn rounded-lg border-base-300 bg-base-100 font-normal"
              @click="actPark"
            >
              {{ t("pass.suspend") }} <kbd class="kbd kbd-xs ml-1">S</kbd>
            </button>
            <button
              class="btn rounded-lg border-base-300 bg-base-100 font-normal"
              @click="act('cancel')"
            >
              {{ t("pass.cancel") }} <kbd class="kbd kbd-xs ml-1">X</kbd>
            </button>
          </div>
        </motion.div>

        <motion.div
          v-else
          key="done"
          v-bind="passCardMotion"
          class="mt-5 rounded-2xl bg-base-100 p-8 text-center text-base-content"
        >
          <p class="text-[16px] font-semibold">{{ t("pass.finished") }}</p>
          <p class="mt-1 text-[12px] text-base-content/65">
            {{
              t("pass.counts", {
                keep: passVM.state.counts.keep,
                done: passVM.state.counts.done,
                park: passVM.state.counts.park,
                cancel: passVM.state.counts.cancel,
              })
            }}
          </p>
          <button
            class="btn mt-4 rounded-lg border-0 bg-base-content text-base-100"
            @click="finish"
          >
            {{ t("pass.backToWeek") }}
          </button>
        </motion.div>
      </AnimatePresence>
    </motion.div>
  </motion.div>
</template>

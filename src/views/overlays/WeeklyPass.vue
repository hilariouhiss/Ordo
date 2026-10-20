<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { shortDate } from "../../lib/dates";
import { appVM } from "../../viewmodels/appVM";
import { passVM } from "../../viewmodels/passVM";
import { taskSheetVM } from "../../viewmodels/taskSheetVM";
import { weekVM } from "../../viewmodels/weekVM";

const suspendOpen = ref(false);
const suspendDate = ref("");

const finished = computed(() => passVM.state.queue.length > 0 && !passVM.current.value);
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
  await passVM.resolve(action);
}

async function actSuspend(): Promise<void> {
  if (!suspendDate.value) return;
  await passVM.resolve("suspend", suspendDate.value);
  suspendOpen.value = false;
  suspendDate.value = "";
}

async function finish(): Promise<void> {
  await passVM.finish();
  appVM.state.passNeeded = false;
  await weekVM.load();
}

function split(): void {
  const card = passVM.splitCurrent();
  if (card) void taskSheetVM.open(card.id);
}

function onKey(event: KeyboardEvent): void {
  if (!passVM.state.open || finished.value) return;
  // While the task sheet is open it owns the keyboard; its own Escape closes just it.
  if (taskSheetVM.state.openId) return;
  if (event.key === "Escape") {
    passVM.close();
    return;
  }
  if (event.key === "Enter") return void act("keep");
  if (event.key.toLowerCase() === "d") return void act("done");
  if (event.key.toLowerCase() === "x") return void act("cancel");
  if (event.key.toLowerCase() === "s") suspendOpen.value = true;
  if (event.key.toLowerCase() === "e") split();
}

onMounted(() => window.addEventListener("keydown", onKey));
onUnmounted(() => window.removeEventListener("keydown", onKey));
</script>

<template>
  <div class="fixed inset-0 z-50 overflow-y-auto bg-neutral/92 p-6 text-neutral-content">
    <div class="mx-auto max-w-[720px]">
      <div class="flex items-center gap-3 text-[12px]">
        <span class="font-medium">过一遍</span>
        <span class="opacity-50">把上周抄下来的逐条结掉</span>
        <span class="ml-auto tabular-nums opacity-70">
          {{ Math.min(passVM.state.index + 1, passVM.state.queue.length) }} /
          {{ passVM.state.queue.length }}
        </span>
      </div>

      <template v-if="passVM.current.value">
        <div class="mt-5 rounded-2xl bg-base-100 p-6 text-base-content">
          <div class="flex flex-wrap items-center gap-2">
            <span
              v-if="passVM.current.value.carryCount"
              class="badge badge-soft badge-warning badge-sm"
            >
              第 {{ passVM.current.value.carryCount }} 次抄回来
            </span>
            <span v-if="projectName" class="badge badge-ghost badge-sm">{{ projectName }}</span>
            <span v-if="categoryName" class="badge badge-ghost badge-sm">{{ categoryName }}</span>
            <span class="text-[11.5px] text-base-content/45">
              {{ ownerName }} · 截止 {{ shortDate(passVM.current.value.dueDate) || "未定" }}
            </span>
          </div>

          <h2 class="mt-3 text-[22px] font-semibold tracking-tight">
            {{ passVM.current.value.title }}
          </h2>

          <p
            v-if="passVM.current.value.carryCount >= 3"
            class="mt-4 rounded-lg bg-warning/10 px-3 py-2 text-[11.5px] text-warning"
          >
            连续 {{ passVM.current.value.carryCount }} 次没动。拆开，还是先挂起？
          </p>

          <div class="mt-5 flex flex-wrap items-center gap-2">
            <button
              class="btn rounded-lg border-0 bg-primary px-5 text-primary-content"
              @click="act('keep')"
            >
              继续 <kbd class="kbd kbd-xs ml-1">⏎</kbd>
            </button>
            <button
              class="btn rounded-lg border-base-300 bg-base-100 font-normal"
              @click="act('done')"
            >
              完成 <kbd class="kbd kbd-xs ml-1">D</kbd>
            </button>
            <button class="btn rounded-lg border-base-300 bg-base-100 font-normal" @click="split">
              拆开 <kbd class="kbd kbd-xs ml-1">E</kbd>
            </button>
            <button
              class="btn rounded-lg border-base-300 bg-base-100 font-normal"
              @click="suspendOpen = true"
            >
              挂起 <kbd class="kbd kbd-xs ml-1">S</kbd>
            </button>
            <button
              class="btn rounded-lg border-base-300 bg-base-100 font-normal"
              @click="act('cancel')"
            >
              取消 <kbd class="kbd kbd-xs ml-1">X</kbd>
            </button>
          </div>

          <div v-if="suspendOpen" class="mt-4 rounded-xl bg-base-200 p-3">
            <div class="text-[12px] font-medium">什么时候再看它？</div>
            <div class="mt-2 flex items-center gap-2">
              <input
                v-model="suspendDate"
                type="date"
                class="input input-sm rounded-lg border-base-300"
              />
              <button
                class="btn btn-sm rounded-lg border-0 bg-primary text-primary-content"
                @click="actSuspend"
              >
                挂起
              </button>
              <button
                class="btn btn-sm rounded-lg border-base-300 bg-base-100 font-normal"
                @click="suspendOpen = false"
              >
                返回
              </button>
            </div>
            <p class="mt-2 text-[10.5px] text-base-content/45">
              日子是必填的。到那天早上九点它会来问你开始没有。
            </p>
          </div>
        </div>
      </template>

      <div v-else class="mt-5 rounded-2xl bg-base-100 p-8 text-center text-base-content">
        <p class="text-[16px] font-semibold">这一轮过完了</p>
        <p class="mt-1 text-[12px] text-base-content/45">
          继续 {{ passVM.state.counts.keep }} · 完成 {{ passVM.state.counts.done }} · 挂起
          {{ passVM.state.counts.suspend }} · 取消 {{ passVM.state.counts.cancel }}
        </p>
        <button
          class="btn mt-4 rounded-lg border-0 bg-primary text-primary-content"
          @click="finish"
        >
          回到本周
        </button>
      </div>
    </div>
  </div>
</template>

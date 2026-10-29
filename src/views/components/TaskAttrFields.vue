<script setup lang="ts">
import { t } from "../../lib/i18n";
import type { TaskAttrs } from "../../model/types";
import { appVM } from "../../viewmodels/appVM";
import EffortField from "./EffortField.vue";

const attrs = defineModel<TaskAttrs>({ required: true });
</script>

<template>
  <label class="mt-3 block text-[11px] text-base-content/45">
    {{ t("task.project") }}
    <select
      v-model="attrs.projectId"
      class="select select-sm mt-1 w-full rounded-lg border-base-300"
    >
      <option :value="null">{{ t("task.noProject") }}</option>
      <option v-for="project in appVM.state.projects" :key="project.id" :value="project.id">
        {{ project.name }}
      </option>
    </select>
  </label>

  <div class="mt-2 grid grid-cols-2 gap-2">
    <label class="block text-[11px] text-base-content/45">
      {{ t("task.category") }}
      <select
        v-model="attrs.categoryId"
        class="select select-sm mt-1 w-full rounded-lg border-base-300"
      >
        <option :value="null">{{ t("common.uncategorized") }}</option>
        <option v-for="category in appVM.state.categories" :key="category.id" :value="category.id">
          {{ category.name }}
        </option>
      </select>
    </label>
    <label class="block text-[11px] text-base-content/45">
      {{ t("task.owner") }}
      <select
        v-model="attrs.ownerId"
        class="select select-sm mt-1 w-full rounded-lg border-base-300"
      >
        <option :value="null">{{ t("task.unassigned") }}</option>
        <option v-for="person in appVM.state.people" :key="person.id" :value="person.id">
          {{ person.name }}
        </option>
      </select>
    </label>
    <label class="block text-[11px] text-base-content/45">
      {{ t("task.priority") }}
      <select
        v-model="attrs.priority"
        class="select select-sm mt-1 w-full rounded-lg border-base-300"
      >
        <option value="high">{{ t("task.priorityHigh") }}</option>
        <option value="normal">{{ t("task.priorityNormal") }}</option>
        <option value="low">{{ t("task.priorityLow") }}</option>
      </select>
    </label>
    <label class="block text-[11px] text-base-content/45">
      {{ t("task.effort") }}
      <div class="mt-1">
        <EffortField v-model="attrs.effortMinutes" />
      </div>
    </label>
  </div>

  <div class="mt-3 flex items-center gap-1.5">
    <button
      type="button"
      class="btn btn-xs rounded-md border-base-300 font-normal"
      :class="attrs.exclusive ? 'bg-base-100' : 'border-0 bg-primary text-primary-content'"
      @click="attrs.exclusive = false"
    >
      {{ t("task.shared") }}
    </button>
    <button
      type="button"
      class="btn btn-xs rounded-md border-base-300 font-normal"
      :class="attrs.exclusive ? 'border-0 bg-primary text-primary-content' : 'bg-base-100'"
      @click="attrs.exclusive = true"
    >
      {{ t("task.exclusive") }}
    </button>
    <span class="ml-1 text-[10.5px] text-base-content/40">{{
      t(attrs.exclusive ? "task.exclusiveHint" : "task.sharedHint")
    }}</span>
  </div>
</template>

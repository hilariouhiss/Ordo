<script setup lang="ts">
import { Check, ChevronDown } from "@lucide/vue";
import { computed, nextTick, ref } from "vue";
import { useAnchorPopup } from "../../lib/useAnchorPopup";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  modelValue: string;
  options: { value: string; label: string }[];
  label?: string;
}>();

const emit = defineEmits<{ "update:modelValue": [value: string] }>();

const selectedIndex = computed(() =>
  Math.max(
    0,
    props.options.findIndex((option) => option.value === props.modelValue),
  ),
);
const selectedLabel = computed(
  () => props.options.find((option) => option.value === props.modelValue)?.label ?? "",
);
const active = ref(0);
const list = ref<HTMLElement | null>(null);
const panelHeight = computed(() => Math.min(props.options.length * 28 + 8, 240));

const { open, triggerRef, style, panelId, show, close } = useAnchorPopup({
  onClosed: (restoreFocus) => {
    if (restoreFocus) triggerRef.value?.focus();
  },
});

function optionId(index: number): string {
  return `${panelId}-option-${index}`;
}

const activeId = computed(() => optionId(active.value));

function focusList(): void {
  void nextTick(() => list.value?.focus());
}

function scrollActive(): void {
  void nextTick(() =>
    document.getElementById(optionId(active.value))?.scrollIntoView({ block: "nearest" }),
  );
}

function onTrigger(): void {
  if (open.value) {
    close(true);
    return;
  }
  active.value = selectedIndex.value;
  show({ width: 140, height: panelHeight.value });
  focusList();
  scrollActive();
}

function choose(index: number): void {
  const option = props.options[index];
  if (!option) return;
  emit("update:modelValue", option.value);
  close(true);
}

function onListKey(event: KeyboardEvent): void {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    active.value = Math.max(
      0,
      Math.min(props.options.length - 1, active.value + (event.key === "ArrowDown" ? 1 : -1)),
    );
    scrollActive();
  } else if (event.key === "Home" || event.key === "End") {
    event.preventDefault();
    active.value = event.key === "Home" ? 0 : props.options.length - 1;
    scrollActive();
  } else if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    choose(active.value);
  } else if (event.key === "Tab") {
    event.preventDefault();
    close(true);
  }
}
</script>

<template>
  <button
    ref="triggerRef"
    v-bind="$attrs"
    type="button"
    class="select cursor-pointer text-left"
    :aria-haspopup="'listbox'"
    :aria-expanded="open"
    :aria-controls="panelId"
    @click="onTrigger"
  >
    <span class="truncate">{{ selectedLabel }}</span>
    <ChevronDown :size="14" class="shrink-0 text-base-content/40" aria-hidden="true" />
  </button>
  <Teleport to="body">
    <div
      v-if="open"
      :id="panelId"
      role="listbox"
      :aria-label="label"
      :aria-activedescendant="activeId"
      tabindex="-1"
      :style="style"
      class="fixed z-[90] max-h-60 overflow-y-auto rounded-xl border border-base-300 bg-base-100 p-1 text-base-content shadow-2xl outline-none"
      @keydown="onListKey"
    >
      <div
        v-for="(option, index) in options"
        :id="optionId(index)"
        :key="option.value"
        role="option"
        :aria-selected="option.value === modelValue"
        class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[11px]"
        :class="index === active ? 'bg-base-200' : ''"
        @click="choose(index)"
        @mouseenter="active = index"
      >
        <span
          class="min-w-0 flex-1 truncate"
          :class="option.value === modelValue ? 'text-primary' : ''"
        >
          {{ option.label }}
        </span>
        <Check
          v-if="option.value === modelValue"
          :size="12"
          class="shrink-0 text-primary"
          aria-hidden="true"
        />
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* A chip draws its own soft chevron; daisyUI's hard-edged caret is not it. */
.select {
  gap: 2px;
  padding-inline-end: 2px;
  background-image: none;
}
</style>

import { computed, reactive } from "vue";
import { parseCapture, type CaptureContext } from "../lib/capture";
import type { CaptureFields } from "../model/types";

export type CaptureField = keyof CaptureFields;

/**
 * The pending capture line plus the fields below it. Symbol tokens are parsed
 * on every change; a click on a chip writes a manual override that survives
 * further typing until the line is cleared or saved.
 */
export function createCaptureDraftVM(
  context: () => CaptureContext,
  base: () => Partial<CaptureFields> = () => ({}),
) {
  const state = reactive({
    raw: "",
    manual: {} as Partial<CaptureFields>,
  });

  const parsed = computed(() => parseCapture(state.raw, context(), base()));
  const title = computed(() => parsed.value.title);
  const fields = computed<CaptureFields>(() => ({ ...parsed.value.fields, ...state.manual }));
  const matched = computed(() => parsed.value.matched.filter((field) => !(field in state.manual)));

  function setRaw(raw: string): void {
    state.raw = raw;
    if (!raw.trim()) state.manual = {};
  }

  function edit(patch: Partial<CaptureFields>): void {
    state.manual = { ...state.manual, ...patch };
  }

  function reset(): void {
    state.raw = "";
    state.manual = {};
  }

  return { state, title, fields, matched, setRaw, edit, reset };
}

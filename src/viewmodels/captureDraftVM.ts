import { computed, reactive } from "vue";
import { parseCapture, type CaptureContext } from "../lib/capture";
import { finishForEffort } from "../lib/timing";
import type { CaptureFields } from "../model/types";

export type CaptureField = keyof CaptureFields | "newProject";

/**
 * The pending capture line plus the fields below it. Symbol tokens are parsed on
 * every change; a click on a chip writes a manual override that survives further
 * typing until the line is cleared or saved.
 *
 * The expected finish is never typed: it is the working day the estimate needs,
 * counted from the capture day. `finish` exposes that preview without storing it.
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
  const newProjectName = computed(() =>
    state.manual.projectId !== undefined ? null : parsed.value.newProjectName,
  );
  const matched = computed(() =>
    parsed.value.matched.filter((field) => {
      if (field === "newProject") return state.manual.projectId === undefined;
      return !(field in state.manual);
    }),
  );
  const finish = computed(() => finishForEffort(context().today, fields.value.effortMinutes));

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

  return { state, title, fields, matched, finish, newProjectName, setRaw, edit, reset };
}

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
 * `done` records a line that already happened; it clears with the line so the next
 * capture starts as an ordinary one.
 */
export function createCaptureDraftVM(
  context: () => CaptureContext,
  base: () => Partial<CaptureFields> = () => ({}),
) {
  const state = reactive({
    raw: "",
    manual: {} as Partial<CaptureFields>,
    done: false,
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
  const done = computed(() => state.done);

  function setRaw(raw: string): void {
    state.raw = raw;
    if (!raw.trim()) {
      state.manual = {};
      state.done = false;
    }
  }

  function edit(patch: Partial<CaptureFields>): void {
    state.manual = { ...state.manual, ...patch };
  }

  function setDone(value: boolean): void {
    state.done = value;
  }

  function reset(): void {
    state.raw = "";
    state.manual = {};
    state.done = false;
  }

  return {
    state,
    title,
    fields,
    matched,
    finish,
    done,
    newProjectName,
    setRaw,
    edit,
    setDone,
    reset,
  };
}

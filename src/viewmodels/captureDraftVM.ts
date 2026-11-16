import { computed, reactive } from "vue";
import { parseCapture, type CaptureContext } from "../lib/capture";
import { localDate, stampOfLocal } from "../lib/dates";
import { finishForEffort } from "../lib/timing";
import type { CaptureFields } from "../model/types";

export type CaptureField = keyof CaptureFields | "newProject";

/**
 * The pending capture line plus the fields below it. Symbol tokens are parsed on
 * every change; a click on a chip writes a manual override that survives further
 * typing until the line is cleared or saved.
 *
 * The expected finish is never typed: it is the working day the estimate needs,
 * counted from the planned start (today when it has none). A done line measures its
 * actual finish from the actual day instead. Both expose a preview without storing it.
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
  const fields = computed<CaptureFields>(() => {
    const merged = { ...parsed.value.fields, ...state.manual };
    // A day picked while the done switch was on must not start an ordinary line.
    if (!state.done) merged.actualStartDate = null;
    return merged;
  });
  const newProjectName = computed(() =>
    state.manual.projectId !== undefined ? null : parsed.value.newProjectName,
  );
  const matched = computed(() =>
    parsed.value.matched.filter((field) => {
      if (field === "newProject") return state.manual.projectId === undefined;
      return !(field in state.manual);
    }),
  );
  /** The day the plan counts from: an empty start means today. */
  const expectedStart = computed(() => fields.value.expectedStartDate || context().today);
  const finish = computed(() => finishForEffort(expectedStart.value, fields.value.effortMinutes));
  /** A done line's actual day; an empty start means today, like the plan. */
  const actualStart = computed(() => fields.value.actualStartDate || context().today);
  /** The done preview: local 09:00 on the actual day plus the actual effort. */
  const actualFinish = computed(() => {
    const stamp = stampOfLocal(actualStart.value, "09:00");
    if (!stamp) return "";
    const end = Date.parse(stamp) + fields.value.effortMinutes * 60_000;
    return localDate(new Date(end).toISOString());
  });
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
    expectedStart,
    finish,
    actualStart,
    actualFinish,
    done,
    newProjectName,
    setRaw,
    edit,
    setDone,
    reset,
  };
}

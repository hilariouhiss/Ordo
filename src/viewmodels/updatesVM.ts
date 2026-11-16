import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { computed, reactive } from "vue";

export type UpdatePhase =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "failed";

/** What a check found, as told to whoever asked for it. */
export type UpdateOutcome = "none" | "available" | "failed" | "disabled";

/** What the About tab's one button does for the state on screen: install the version it
 * knows, otherwise run a check. A failed check keeps the check it can retry. */
export function updateAction(phase: UpdatePhase, hasVersion: boolean): "install" | "check" {
  return hasVersion && phase !== "failed" ? "install" : "check";
}

export interface UpdatesState {
  phase: UpdatePhase;
  /** Running version, read once from the bundle; empty until it arrives. */
  currentVersion: string;
  /** Version the card is about; null before a check finds one. */
  version: string | null;
  /** Whole percent while downloading; null when the server sends no length. */
  percent: number | null;
  error: string | null;
  checkedAt: number | null;
  /** The version the card was closed on: quiet for the rest of this run. */
  dismissedVersion: string | null;
}

/** How often a long-running window re-checks after the start-up one. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const START_DELAY_MS = 3_000;
const CHECK_TIMEOUT_MS = 30_000;

const IDLE = {
  phase: "idle" as const,
  currentVersion: "",
  version: null,
  percent: null,
  error: null,
  checkedAt: null,
  dismissedVersion: null,
};

export function createUpdatesVM() {
  const state = reactive<UpdatesState>({ ...IDLE });
  let pending: Update | null = null;
  let downloaded = false;

  /** A dev build must never be replaced by a release, and a browser tab has no plugins. */
  const enabled = () => isTauri() && !import.meta.env.DEV;

  let first: ReturnType<typeof setTimeout> | null = null;
  let repeat: ReturnType<typeof setInterval> | null = null;

  function stopTimers(): void {
    if (first !== null) {
      clearTimeout(first);
      first = null;
    }
    if (repeat !== null) {
      clearInterval(repeat);
      repeat = null;
    }
  }

  function schedule(): void {
    if (first !== null || repeat !== null) return;
    first = setTimeout(() => {
      first = null;
      void checkNow();
    }, START_DELAY_MS);
    repeat = setInterval(() => {
      // A check now would only race the thing the user just pressed.
      if (state.phase === "downloading" || state.phase === "installing") return;
      void checkNow();
    }, CHECK_INTERVAL_MS);
  }

  const visible = computed(
    () =>
      state.version !== null &&
      state.dismissedVersion !== state.version &&
      state.phase !== "idle" &&
      state.phase !== "checking",
  );

  function patch(next: Partial<UpdatesState>): void {
    Object.assign(state, next);
  }

  function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  async function loadVersion(): Promise<void> {
    if (!isTauri() || state.currentVersion) return;
    try {
      state.currentVersion = await getVersion();
    } catch {
      // Only the version line in settings loses its value.
    }
  }

  async function download(): Promise<boolean> {
    const update = pending;
    if (!update) return false;
    let received = 0;
    let total: number | null = null;
    patch({ phase: "downloading", percent: null, error: null });
    try {
      await update.download((event) => {
        if (event.event === "Started") {
          total = event.data.contentLength ?? null;
          // A server without a length leaves the bar indeterminate, not at 0%.
          patch({ percent: total === null ? null : 0 });
          return;
        }
        if (event.event !== "Progress") return;
        received += event.data.chunkLength;
        if (total !== null && total > 0) {
          patch({ percent: Math.min(100, Math.round((received / total) * 100)) });
        }
      });
    } catch (error) {
      patch({ phase: "failed", error: describe(error) });
      return false;
    }
    downloaded = true;
    patch({ phase: "ready", percent: total === null ? null : 100 });
    return true;
  }

  /** One check. The automatic path stays quiet; settings says the outcome out loud. */
  async function checkNow(): Promise<UpdateOutcome> {
    if (!enabled()) return "disabled";
    patch({ phase: "checking", error: null });
    try {
      const found = await check({ timeout: CHECK_TIMEOUT_MS });
      if (!found) {
        void pending?.close();
        pending = null;
        downloaded = false;
        patch({
          phase: "idle",
          version: null,
          percent: null,
          dismissedVersion: null,
          checkedAt: Date.now(),
        });
        return "none";
      }
      if (pending && pending.version === found.version) {
        // A re-check of the version already on screen: keep the bytes we have.
        void found.close();
        patch({ checkedAt: Date.now() });
        return "available";
      }
      void pending?.close();
      pending = found;
      downloaded = false;
      patch({
        phase: "available",
        version: found.version,
        percent: null,
        dismissedVersion: null,
        checkedAt: Date.now(),
      });
      return "available";
    } catch (error) {
      patch({ phase: "failed", error: describe(error), checkedAt: Date.now() });
      return "failed";
    }
  }

  /** Downloads when needed, then hands the install to the plugin and restarts. */
  async function install(): Promise<boolean> {
    if (!enabled()) return false;
    if (state.phase === "downloading" || state.phase === "installing") return false;
    const update = pending;
    if (!update) return false;
    if (!downloaded && !(await download())) return false;
    patch({ phase: "installing" });
    try {
      await update.install();
      // The installer owns the files now; relaunch is the last thing this flow does.
      await relaunch();
      return true;
    } catch (error) {
      patch({ phase: "failed", error: describe(error) });
      return false;
    }
  }

  /** Hides the card for the version it is about; a newer version or the next launch brings it back. */
  function dismiss(): void {
    state.dismissedVersion = state.version;
  }

  /** Start-up check after a short delay, then every six hours, when the preference allows it. */
  function start(autoCheck: boolean): () => void {
    void loadVersion();
    if (!enabled() || !autoCheck) return stopTimers;
    schedule();
    return stopTimers;
  }

  /** The settings switch: turning it on starts the schedule, off stops it. */
  function applyAutoCheck(autoCheck: boolean): void {
    if (!enabled()) return;
    if (autoCheck) schedule();
    else stopTimers();
  }

  return { state, visible, loadVersion, start, applyAutoCheck, checkNow, install, dismiss };
}

export const updatesVM = createUpdatesVM();

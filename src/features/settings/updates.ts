/**
 * In-app auto-update (R15): check → download → prompt → install → restart.
 *
 * The app ships with a signing public key (`tauri.conf.json` → `plugins.updater`)
 * and asks GitHub Releases for `latest.json`; the plugin verifies the signature
 * of whatever it downloads, so this module never handles bytes or keys.
 *
 * Three decisions worth knowing before editing:
 *
 * - **Download and install are separate calls.** `install()` is what replaces
 *   the running program, and on Windows that means the installer has to take
 *   over the app while it exits. So the download happens quietly in the
 *   background and the install happens at the moment the user agreed to (or let
 *   the countdown run out) — which is also what makes 「稍后」 possible at all.
 * - **Failures are quiet.** A check runs every six hours on a machine that is
 *   sometimes offline; a toast per failed check would train the user to ignore
 *   the one that matters. The error is kept in the state for the settings page,
 *   and only a check the user asked for is answered out loud (the caller does
 *   that — this module never pushes a notification).
 * - **Nothing runs in a dev build.** `pnpm tauri dev` serves the app from Vite
 *   with `version` 0.1.4 and no installer around it; installing an update over
 *   it would replace a development build with a release one.
 */

import { createSignal } from "solid-js";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { openDialogCount } from "../../common/stores/dialogs";

export type UpdatePhase = "idle" | "checking" | "downloading" | "ready" | "installing" | "failed";

/** What the update UI reads. `checkNow`'s caller gets the same names back. */
export type UpdateOutcome = "none" | "ready" | "failed" | "disabled";

export interface UpdateState {
  phase: UpdatePhase;
  /** Version being downloaded / waiting to install; `null` before a check finds one. */
  version: string | null;
  /** Download progress in whole percent; `null` when the length is unknown. */
  percent: number | null;
  /** Why the last attempt failed; shown in the settings page, never as a toast. */
  error: string | null;
  /** When the last check finished (epoch ms); the settings page prints it. */
  checkedAt: number | null;
  /** Whether a restart is still coming on its own. 「稍后」 clears it; the
   * update stays downloaded and 「立即重启」 keeps working. */
  autoRestart: boolean;
}

/** How often a long-running window re-checks after the start-up check. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Seconds the prompt gives the user before it installs and restarts. */
export const RESTART_COUNTDOWN_SECONDS = 5;

const IDLE: UpdateState = {
  phase: "idle",
  version: null,
  percent: null,
  error: null,
  checkedAt: null,
  autoRestart: true,
};

const [state, setState] = createSignal<UpdateState>(IDLE);
const [countdown, setCountdown] = createSignal<number | null>(null);

/** Current update state. Read-only: the flow is the only writer. */
export const updateState = state;

/** Seconds left before the automatic restart, or `null` when none is running.
 *
 * Derived from the open-dialog count rather than only from the timer: a dialog
 * opening at second three must turn the card into 「正在等待…」 at once, not up
 * to a second later — the number the user reads has to be the number that will
 * happen. */
export const countdownSeconds = () => (openDialogCount() > 0 ? null : countdown());

/** Read lazily: a dev build must never be replaced by a release build. */
const enabled = () => !import.meta.env.DEV;

/** The update found by the last check, kept for `install()` at restart time. */
let pending: Update | null = null;
let countdownTimer: ReturnType<typeof setInterval> | undefined;

function stopCountdown(): void {
  if (countdownTimer !== undefined) clearInterval(countdownTimer);
  countdownTimer = undefined;
  setCountdown(null);
}

function patch(next: Partial<UpdateState>): void {
  setState((current) => ({ ...current, ...next }));
}

/** Turns any thrown value into the one line the settings page shows. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Arms the restart countdown. Every tick asks whether a dialog is open first:
 * while one is, the countdown reads `null` — the prompt says it is waiting
 * rather than restarting the app under someone's cursor — and the five seconds
 * start over once the dialog closes. It never expires: the user's dialog is
 * the clock.
 */
function armCountdown(): void {
  stopCountdown();
  const tick = () => {
    if (openDialogCount() > 0) {
      setCountdown(null);
      return;
    }
    const left = countdown();
    if (left === null) {
      setCountdown(RESTART_COUNTDOWN_SECONDS);
      return;
    }
    if (left > 1) {
      setCountdown(left - 1);
      return;
    }
    void installAndRestart();
  };
  tick();
  countdownTimer = setInterval(tick, 1000);
}

/** Downloads the update `check()` returned, reporting progress into the state. */
async function download(update: Update): Promise<void> {
  let received = 0;
  let total: number | null = null;
  patch({ phase: "downloading", version: update.version, percent: null, error: null });
  await update.download((event) => {
    if (event.event === "Started") {
      total = event.data.contentLength ?? null;
      // A server that sends no length leaves the bar indeterminate; the
      // percentage stays unknown rather than pretending to be 0%.
      patch({ percent: total === null ? null : 0 });
      return;
    }
    if (event.event !== "Progress") return;
    received += event.data.chunkLength;
    if (total !== null && total > 0) {
      patch({ percent: Math.min(100, Math.round((received / total) * 100)) });
    }
  });
  pending = update;
  patch({ phase: "ready", percent: total === null ? null : 100, autoRestart: true });
  armCountdown();
}

/** One check-download pass; the shared body of the auto path and `checkNow`. */
async function runCheck(): Promise<UpdateOutcome> {
  if (!enabled()) return "disabled";
  patch({ phase: "checking", error: null });
  try {
    const update = await check();
    if (!update) {
      pending = null;
      patch({ phase: "idle", version: null, percent: null, checkedAt: Date.now() });
      return "none";
    }
    await download(update);
    patch({ checkedAt: Date.now() });
    return "ready";
  } catch (error) {
    patch({ phase: "failed", error: describe(error), checkedAt: Date.now() });
    return "failed";
  }
}

/**
 * Installs what the last check downloaded and restarts into it. Called by the
 * prompt's 「现在重启」, by the countdown reaching zero, and by the settings
 * page. Returns whether the restart was issued, so a caller that has a place to
 * say something can say it.
 */
export async function installAndRestart(): Promise<boolean> {
  stopCountdown();
  const update = pending;
  if (!update) return false;
  patch({ phase: "installing" });
  try {
    await update.install();
    // Windows: the installer has taken over the files; this process is about to
    // be replaced, so `relaunch()` is the last thing this flow does.
    await relaunch();
    return true;
  } catch (error) {
    patch({ phase: "failed", error: describe(error) });
    return false;
  }
}

/** 「稍后」: stop the automatic restart, keep the downloaded update in hand. */
export function postpone(): void {
  stopCountdown();
  patch({ autoRestart: false });
}

/**
 * Closes the prompt after a failure. The error stays in the state — the
 * settings page is where it remains readable — only the card goes away.
 */
export function dismiss(): void {
  patch({ phase: "idle" });
}

/**
 * Starts the automatic path: one check now, then every `CHECK_INTERVAL_MS`.
 * Returns the disposer that clears the interval (the shell registers it with
 * `onCleanup`). A build where updates are disabled does nothing at all.
 */
export function startAutoUpdate(): () => void {
  if (!enabled()) return () => {};
  void runCheck();
  const timer = setInterval(() => {
    // A ready update is waiting on the user, not on the server; re-checking
    // would download it a second time.
    if (updateState().phase === "ready" || updateState().phase === "installing") return;
    void runCheck();
  }, CHECK_INTERVAL_MS);
  return () => clearInterval(timer);
}

/**
 * The settings page's 「检查更新」. Same flow as the automatic one — the only
 * difference is that it hands the outcome back so the caller can say it out
 * loud instead of leaving it in the state.
 */
export async function checkNow(): Promise<UpdateOutcome> {
  return runCheck();
}

/** Test seam: back to a fresh install's state, timers cleared. */
export function resetUpdates(): void {
  stopCountdown();
  pending = null;
  setState(IDLE);
}

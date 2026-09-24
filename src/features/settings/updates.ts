/**
 * In-app auto-update (R15): check → prompt → download → install → restart.
 *
 * The app ships with a signing public key (`tauri.conf.json` → `plugins.updater`)
 * and asks GitHub Releases for `latest.json`; the plugin verifies the signature
 * of whatever it downloads, so this module never handles bytes or keys.
 *
 * Four decisions worth knowing before editing:
 *
 * - **Nothing is installed until the user asks.** A check only ever *finds* an
 *   update; the card appears, and the app restarts into the new version when
 *   「更新」 is pressed. There is no countdown and no automatic restart: the
 *   moment this app takes over someone's screen is not a timer's to decide.
 * - **Downloading early is a setting, not a policy.** `automaticDownload`
 *   (default on) fetches the update in the background so the click is quick;
 *   turned off, nothing touches the network until 「下载并更新」 is pressed.
 *   Either way the install waits for the click.
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
import { safeGetItem, safeSetItem } from "../../common/stores/ui";

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

export interface UpdateState {
  phase: UpdatePhase;
  /** Version the card is about; `null` before a check finds one. */
  version: string | null;
  /** Download progress in whole percent; `null` when nothing is downloading, or
   * when the server sent no length. */
  percent: number | null;
  /** Why the last attempt failed; shown in the settings page, never as a toast. */
  error: string | null;
  /** When the last check finished (epoch ms); the settings page prints it. */
  checkedAt: number | null;
  /** The version the user closed the card on (「稍后」, or a failure they have
   * read). The same version stays quiet for the rest of the session; a newer
   * one — or the next launch — brings the card back. */
  dismissedVersion: string | null;
}

/** How often a long-running window re-checks after the start-up check. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** Where the silent-download preference lives (the same localStorage convention
 * as the theme and the sidebar width, `common/stores/ui.ts`). */
export const AUTO_DOWNLOAD_STORAGE_KEY = "ordo.updateAutoDownload";

const IDLE: UpdateState = {
  phase: "idle",
  version: null,
  percent: null,
  error: null,
  checkedAt: null,
  dismissedVersion: null,
};

const [state, setState] = createSignal<UpdateState>(IDLE);
const [autoDownload, setAutoDownloadSignal] = createSignal(
  safeGetItem(AUTO_DOWNLOAD_STORAGE_KEY) !== "0",
);

/** Current update state. Read-only: the flow is the only writer. */
export const updateState = state;

/** Whether a found update is downloaded before the user asks for it. Default
 * on; the settings page owns the switch. */
export const automaticDownload = autoDownload;

/** Persists the preference and applies it for the rest of this session. */
export function setAutoDownload(enabled: boolean): void {
  setAutoDownloadSignal(enabled);
  safeSetItem(AUTO_DOWNLOAD_STORAGE_KEY, enabled ? "1" : "0");
}

/** Read lazily: a dev build must never be replaced by a release build. */
const enabled = () => !import.meta.env.DEV;

/** The update the card is about, plus whether its bytes are already on disk. */
let pending: Update | null = null;
let downloaded = false;

function patch(next: Partial<UpdateState>): void {
  setState((current) => ({ ...current, ...next }));
}

/** Turns any thrown value into the one line the settings page shows. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Downloads the pending update, reporting progress into the state. */
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
  } catch (error) {
    patch({ phase: "failed", error: describe(error) });
    return false;
  }
  downloaded = true;
  patch({ phase: "ready", percent: total === null ? null : 100 });
  return true;
}

/** One check: finds an update, and downloads it only when the preference says so. */
async function runCheck(): Promise<UpdateOutcome> {
  if (!enabled()) return "disabled";
  patch({ phase: "checking", error: null });
  try {
    const found = await check();
    if (!found) {
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
    // The same version the card already holds, bytes already on disk: fetching
    // it again every six hours would be the price of a prompt nobody dismissed.
    const alreadyHere = downloaded && pending !== null && pending.version === found.version;
    if (alreadyHere) {
      patch({ checkedAt: Date.now() });
    } else {
      pending = found;
      downloaded = false;
      patch({
        phase: "available",
        version: found.version,
        percent: null,
        checkedAt: Date.now(),
        dismissedVersion: null,
      });
    }
    if (!alreadyHere && automaticDownload()) await download();
    return "available";
  } catch (error) {
    patch({ phase: "failed", error: describe(error), checkedAt: Date.now() });
    return "failed";
  }
}

/**
 * 「更新」/「下载并更新」: downloads when the bytes are not here yet, then installs
 * and restarts. Returns whether the restart was issued, so a caller with a
 * place to say something can say it. This is the only path that replaces the
 * running app, and it only ever runs because someone pressed the button.
 */
export async function startUpdate(): Promise<boolean> {
  if (!pending) return false;
  if (!downloaded && !(await download())) return false;
  const update = pending;
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

/**
 * Hides the card for the version it is about — 「稍后」, or closing a failure
 * someone has read. Nothing is un-downloaded and the settings page keeps the
 * state; the card returns on the next launch, or when a newer version lands.
 */
export function dismissPrompt(): void {
  patch({ dismissedVersion: state().version });
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
    // Downloading or installing is already an answer; a check now would only
    // race the thing the user just pressed.
    const phase = updateState().phase;
    if (phase === "downloading" || phase === "installing") return;
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

/** Test seam: back to a fresh install's state — flow cleared, preference
 * re-read from storage (a fresh install has none, i.e. the default). */
export function resetUpdates(): void {
  pending = null;
  downloaded = false;
  setAutoDownloadSignal(safeGetItem(AUTO_DOWNLOAD_STORAGE_KEY) !== "0");
  setState(IDLE);
}

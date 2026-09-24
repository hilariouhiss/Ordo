import { Match, Switch, Show } from "solid-js";
import { Download, RefreshCw, RotateCw, X } from "lucide-solid";
import { Button, iconButtonClass } from "../../../common/components";
import { countdownSeconds, dismiss, installAndRestart, postpone, updateState } from "../updates";

/**
 * The floating update card (R15). Non-modal on purpose: it reports something
 * the app is doing on its own and asks for one decision, so it must not steal
 * focus from whatever the user is doing — the same reasoning as the quick-add
 * window being a separate surface rather than a dialog.
 *
 * It shows nothing while a check runs and nothing when a check fails: the
 * automatic path is silent by design (`updates.ts`). It appears once there is a
 * version to talk about — downloading it, waiting to install it, failing to.
 *
 * The card lives at the window's bottom-left, opposite the toast stack, so a
 * failure toast and an update card can be on screen at the same time.
 */
export function UpdatePrompt() {
  const state = updateState;
  /** A version is what makes this card the user's business; a bare check
   * failure is not (see the module comment). */
  const visible = () => state().version !== null && state().phase !== "idle";

  return (
    <Show when={visible()}>
      <div
        role="status"
        aria-live="polite"
        class="animate-toast-in fixed bottom-4 left-4 z-40 flex w-80 flex-col gap-2 rounded-lg bg-elevated p-3 text-sm text-foreground shadow-lg"
      >
        <div class="flex items-start gap-2">
          <span class="mt-0.5 shrink-0 text-subtle-foreground">
            <Switch>
              <Match when={state().phase === "installing"}>
                <RefreshCw size={15} aria-hidden="true" />
              </Match>
              <Match when={state().phase === "failed"}>
                <X size={15} aria-hidden="true" />
              </Match>
              <Match when={true}>
                <Download size={15} aria-hidden="true" />
              </Match>
            </Switch>
          </span>
          <p class="min-w-0 flex-1 break-words">
            <Switch>
              <Match when={state().phase === "downloading"}>
                正在下载 v{state().version}
                <Show when={state().percent !== null}>（{state().percent}%）</Show>
              </Match>
              <Match when={state().phase === "installing"}>
                正在安装 v{state().version}，马上重启
              </Match>
              <Match when={state().phase === "failed"}>
                更新失败：{state().error}
              </Match>
              {/* Ready. The countdown is `null` in two different situations and
                  they must not read the same: waiting for a dialog to close is
                  a pause, 「稍后」 is a decision. */}
              <Match when={!state().autoRestart}>
                v{state().version} 已下载，下次启动时更新
              </Match>
              <Match when={countdownSeconds() === null}>
                正在等待你关闭当前窗口…（v{state().version} 已下载）
              </Match>
              <Match when={true}>
                v{state().version} 已下载，{countdownSeconds()} 秒后重启
              </Match>
            </Switch>
          </p>
          <Show when={state().phase === "failed"}>
            <button
              type="button"
              aria-label="关闭更新提示"
              class={`${iconButtonClass} -m-1`}
              onClick={dismiss}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </Show>
        </div>

        <Show when={state().phase !== "installing" && state().phase !== "failed"}>
          <div class="flex justify-end gap-2">
            <Show when={state().autoRestart}>
              <Button variant="secondary" size="sm" onClick={postpone}>
                稍后
              </Button>
            </Show>
            <Button size="sm" onClick={() => void installAndRestart()}>
              <RotateCw size={13} aria-hidden="true" />
              {state().autoRestart ? "现在重启" : "立即重启"}
            </Button>
          </div>
        </Show>
      </div>
    </Show>
  );
}

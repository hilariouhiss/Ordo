import { Match, Switch, Show } from "solid-js";
import { Download, RefreshCw, RotateCw, X } from "lucide-solid";
import { Button, iconButtonClass } from "../../../common/components";
import { dismissPrompt, startUpdate, updateState } from "../updates";

/**
 * The update card (R15). Non-modal on purpose: it reports something the app
 * found on its own and asks for one decision, so it must not steal focus from
 * whatever the user is doing. Nothing happens until 「更新」 is pressed — there
 * is no countdown, so the card can sit there as long as the answer takes.
 *
 * It shows nothing while a check runs and nothing when a check fails: the
 * automatic path is silent by design (`updates.ts`). It appears once there is a
 * version to talk about — found, downloading, ready to install, or failing.
 *
 * The card lives at the window's bottom-left, opposite the toast stack, so a
 * failure toast and an update card can be on screen at the same time.
 */
export function UpdatePrompt() {
  const state = updateState;
  /** A version is what makes this card the user's business; a bare check
   * failure is not (see the module comment). */
  const visible = () => {
    const current = state();
    return (
      current.version !== null &&
      current.dismissedVersion !== current.version &&
      current.phase !== "idle" &&
      current.phase !== "checking"
    );
  };

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
              {/* Ready: the bytes are here and the click is all that is left.
                  Available: nothing was downloaded, so 「下载并更新」 does both. */}
              <Match when={state().phase === "ready"}>
                v{state().version} 已下载，点击更新以重启安装
              </Match>
              <Match when={true}>发现新版本 v{state().version}</Match>
            </Switch>
          </p>
          {/* A close button that is always there, not only on failures: an
              update nobody wants to install right now must have a way off the
              screen that is not a decision about the update. It says what
              closing means, since the card does come back. */}
          <Show when={state().phase !== "installing"}>
            <button
              type="button"
              aria-label="关闭更新提示（下次启动再提醒）"
              class={`${iconButtonClass} -m-1`}
              onClick={dismissPrompt}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </Show>
        </div>

        <Show when={state().phase !== "installing" && state().phase !== "failed"}>
          <div class="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={dismissPrompt}>
              稍后
            </Button>
            <Button size="sm" onClick={() => void startUpdate()}>
              <RotateCw size={13} aria-hidden="true" />
              {state().phase === "ready" ? "更新" : "下载并更新"}
            </Button>
          </div>
        </Show>
      </div>
    </Show>
  );
}

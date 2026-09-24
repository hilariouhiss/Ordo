import { Show } from "solid-js";
import { Pause, Play } from "lucide-solid";
import { iconButtonClass } from "../../../common/components";
import { startTimer, stopTimer } from "../hooks";
import { runningEntryOf } from "../store";

/**
 * The 开始/暂停 timer button on a task row (TE-01, reachable without opening
 * the detail). Its state comes from the app-wide running set that
 * `loadRunningTimers` fills and `startTimer`/`stopTimer` keep current — never
 * from `time:list`, which the row would have to fetch once per row.
 *
 * While a timer runs the button stays visible and tinted: a stop target that
 * only appears on hover is one the user has to hunt for. Idle it follows the
 * row's ⋯ button — hidden until the row is hovered or the button is focused.
 */
export function TaskTimerButton(props: { taskId: string; title: string }) {
  const running = () => runningEntryOf(props.taskId);

  const toggle = () => {
    const entry = running();
    if (entry) void stopTimer(props.taskId, entry.id);
    else void startTimer(props.taskId);
  };

  return (
    <button
      type="button"
      class={`${iconButtonClass} group-hover:opacity-100 focus-visible:opacity-100`}
      classList={{
        "opacity-0": running() === undefined,
        "text-primary": running() !== undefined,
      }}
      aria-label={running() ? `暂停计时 ${props.title}` : `开始计时 ${props.title}`}
      aria-pressed={running() !== undefined}
      onClick={toggle}
    >
      <Show when={running()} fallback={<Play size={14} aria-hidden="true" />}>
        <Pause size={14} aria-hidden="true" />
      </Show>
    </button>
  );
}

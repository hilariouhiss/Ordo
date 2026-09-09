import { createSignal, onMount } from "solid-js";
import { loadAll } from "../../hooks";
import { tasksState } from "../../store";

/**
 * Data guard for task views: kicks off the one-shot `loadAll` on first mount
 * and exposes a retry after failures. Navigating to another view before a
 * successful load retries automatically (`loaded` stays false).
 */
export function useViewData() {
  const [failed, setFailed] = createSignal(false);

  async function retry(): Promise<void> {
    setFailed(false);
    const ok = await loadAll();
    setFailed(!ok);
  }

  onMount(() => {
    if (!tasksState.loaded) void retry();
  });

  return { failed, retry };
}

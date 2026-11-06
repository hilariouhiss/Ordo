import { reactive } from "vue";
import { searchAll } from "../model/ipc";
import type { SearchHit } from "../model/types";

const DEBOUNCE_MS = 200;

export function createSearchVM() {
  const state = reactive({
    open: false,
    query: "",
    hits: [] as SearchHit[],
    loading: false,
    error: null as string | null,
    active: 0,
  });
  /** Replies from an older query must not replace the current results. */
  let runId = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer(): void {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  }

  function open(): void {
    clearTimer();
    runId += 1;
    state.open = true;
    state.query = "";
    state.hits = [];
    state.loading = false;
    state.error = null;
    state.active = 0;
  }

  function close(): void {
    clearTimer();
    runId += 1;
    state.open = false;
    state.loading = false;
  }

  async function run(): Promise<void> {
    const query = state.query.trim();
    const mine = ++runId;
    if (!query) {
      state.hits = [];
      state.error = null;
      state.active = 0;
      state.loading = false;
      return;
    }
    state.loading = true;
    state.error = null;
    try {
      const hits = await searchAll(query);
      if (mine !== runId) return;
      state.hits = hits;
      state.active = 0;
    } catch (e) {
      if (mine !== runId) return;
      state.hits = [];
      state.error = String(e);
    } finally {
      if (mine === runId) state.loading = false;
    }
  }

  function setQuery(value: string): void {
    state.query = value;
    state.active = 0;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      void run();
    }, DEBOUNCE_MS);
  }

  function move(delta: 1 | -1): void {
    const count = state.hits.length;
    if (!count) return;
    state.active = (state.active + delta + count) % count;
  }

  function hitAt(index: number): SearchHit | null {
    return state.hits[index] ?? null;
  }

  return { state, open, close, run, setQuery, move, hitAt };
}

export const searchVM = createSearchVM();

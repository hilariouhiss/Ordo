/**
 * Hooks for the search view. Search is read-only: results live in hook-local
 * signals rather than a shared store.
 *
 * `useSearchResults` debounces keystrokes before issuing `search:query` and
 * guards against out-of-order responses — the last issued request wins, a
 * response that arrives after a newer query is dropped.
 *
 * `useSearchData` mirrors the task views' one-shot load guard: clicking a hit
 * opens the task detail dialog, which reads live rows from the tasks store
 * (the search feature's single, directed dependency on the task domain).
 */

import { createEffect, createSignal, on, onCleanup, onMount } from "solid-js";
import { loadAll } from "../tasks/hooks";
import { tasksState } from "../tasks/store";
import * as api from "./api";
import type { SearchHit } from "./types";

/** Keystrokes settle this long before a query is issued. */
const SEARCH_DEBOUNCE_MS = 200;

export interface SearchResults {
  hits: () => SearchHit[];
  /** A request is in flight or waiting out the debounce. */
  searching: () => boolean;
  /** The last non-empty query failed; previous hits are kept. */
  failed: () => boolean;
}

export function useSearchResults(query: () => string): SearchResults {
  const [hits, setHits] = createSignal<SearchHit[]>([]);
  const [searching, setSearching] = createSignal(false);
  const [failed, setFailed] = createSignal(false);
  let seq = 0;

  createEffect(
    on(query, (value) => {
      const request = ++seq;
      const trimmed = value.trim();
      if (!trimmed) {
        setHits([]);
        setSearching(false);
        setFailed(false);
        return;
      }
      setSearching(true);
      const timer = setTimeout(() => {
        api.querySearch(trimmed).then(
          (result) => {
            if (request !== seq) return; // a newer query superseded this one
            setHits(result);
            setSearching(false);
            setFailed(false);
          },
          () => {
            if (request !== seq) return;
            setSearching(false);
            setFailed(true);
          },
        );
      }, SEARCH_DEBOUNCE_MS);
      onCleanup(() => clearTimeout(timer));
    }),
  );

  return { hits, searching, failed };
}

/**
 * One-shot tasks-store load so hit navigation has live rows to open. The
 * search box works regardless; `failed` only degrades the detail dialog and
 * is surfaced by the view as a retryable hint.
 */
export function useSearchData(): {
  failed: () => boolean;
  retry: () => Promise<void>;
} {
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

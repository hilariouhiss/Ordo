import { createSignal } from "solid-js";
import { cleanup, render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../api", () => ({
  querySearch: vi.fn(),
}));

vi.mock("../../tasks/hooks", () => ({
  loadAll: vi.fn(),
}));

vi.mock("../../tasks/store", () => ({
  tasksState: { loaded: false },
}));

import * as api from "../api";
import * as taskHooks from "../../tasks/hooks";
import { useSearchData, useSearchResults, type SearchResults } from "../hooks";
import type { SearchHit } from "../types";

vi.useFakeTimers();

function hit(id: string): SearchHit {
  return { kind: "task", id, taskId: id, taskTitle: `任务 ${id}`, snippet: id };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(cleanup);

describe("useSearchResults", () => {
  async function mount(query: () => string) {
    let result!: SearchResults;
    render(() => {
      result = useSearchResults(query);
      return null;
    });
    // Flush the initial effect run.
    await vi.advanceTimersByTimeAsync(0);
    return () => result;
  }

  it("never queries for blank input and keeps state clear", async () => {
    const get = await mount(() => "   ");
    await vi.advanceTimersByTimeAsync(1000);

    expect(api.querySearch).not.toHaveBeenCalled();
    expect(get().hits()).toEqual([]);
    expect(get().searching()).toBe(false);
  });

  it("debounces keystrokes and delivers results once settled", async () => {
    const [query, setQuery] = createSignal("");
    const get = await mount(query);
    vi.mocked(api.querySearch).mockResolvedValue([hit("t1")]);

    setQuery("设计");
    expect(get().searching()).toBe(true);
    expect(api.querySearch).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);
    expect(api.querySearch).toHaveBeenCalledTimes(1);
    expect(api.querySearch).toHaveBeenCalledWith("设计");
    expect(get().hits()).toEqual([hit("t1")]);
    expect(get().searching()).toBe(false);
    expect(get().failed()).toBe(false);
  });

  it("collapses rapid typing into a single request", async () => {
    const [query, setQuery] = createSignal("");
    const get = await mount(query);
    vi.mocked(api.querySearch).mockResolvedValue([]);

    setQuery("设");
    await vi.advanceTimersByTimeAsync(100);
    setQuery("设计");
    await vi.advanceTimersByTimeAsync(100);
    setQuery("设计稿");
    await vi.advanceTimersByTimeAsync(200);

    expect(api.querySearch).toHaveBeenCalledTimes(1);
    expect(api.querySearch).toHaveBeenCalledWith("设计稿");
    expect(get().searching()).toBe(false);
  });

  it("drops out-of-order responses and keeps the latest query's hits", async () => {
    const [query, setQuery] = createSignal("");
    const get = await mount(query);
    const first = deferred<SearchHit[]>();
    const second = deferred<SearchHit[]>();
    vi.mocked(api.querySearch)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);

    setQuery("第一");
    await vi.advanceTimersByTimeAsync(200);
    setQuery("第二");
    await vi.advanceTimersByTimeAsync(200);
    expect(api.querySearch).toHaveBeenCalledTimes(2);

    // The older request resolves late: its hits must be ignored.
    first.resolve([hit("stale")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(get().hits()).toEqual([]);
    expect(get().searching()).toBe(true);

    second.resolve([hit("fresh")]);
    await vi.advanceTimersByTimeAsync(0);
    expect(get().hits()).toEqual([hit("fresh")]);
    expect(get().searching()).toBe(false);
  });

  it("marks failures, keeps previous hits, and clears on empty query", async () => {
    const [query, setQuery] = createSignal("");
    const get = await mount(query);
    vi.mocked(api.querySearch).mockResolvedValueOnce([hit("t1")]);

    setQuery("正常");
    await vi.advanceTimersByTimeAsync(200);
    expect(get().hits()).toEqual([hit("t1")]);

    vi.mocked(api.querySearch).mockRejectedValueOnce({ code: "database", message: "失败" });
    setQuery("失败词");
    await vi.advanceTimersByTimeAsync(200);
    expect(get().failed()).toBe(true);
    expect(get().searching()).toBe(false);
    expect(get().hits()).toEqual([hit("t1")]);

    setQuery("  ");
    expect(get().hits()).toEqual([]);
    expect(get().failed()).toBe(false);
    expect(api.querySearch).toHaveBeenCalledTimes(2);
  });

  it("cancels the pending request when the query clears", async () => {
    const [query, setQuery] = createSignal("");
    const get = await mount(query);

    setQuery("abc");
    await vi.advanceTimersByTimeAsync(100);
    setQuery("");
    await vi.advanceTimersByTimeAsync(500);

    expect(api.querySearch).not.toHaveBeenCalled();
    expect(get().hits()).toEqual([]);
    expect(get().searching()).toBe(false);
  });
});

describe("useSearchData", () => {
  it("loads tasks on mount, reports failure, and retries", async () => {
    vi.mocked(taskHooks.loadAll).mockResolvedValueOnce(false);

    let result!: ReturnType<typeof useSearchData>;
    render(() => {
      result = useSearchData();
      return null;
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(taskHooks.loadAll).toHaveBeenCalledTimes(1);
    expect(result.failed()).toBe(true);

    vi.mocked(taskHooks.loadAll).mockResolvedValueOnce(true);
    await result.retry();
    expect(taskHooks.loadAll).toHaveBeenCalledTimes(2);
    expect(result.failed()).toBe(false);
  });
});

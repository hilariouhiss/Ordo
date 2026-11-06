import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({ searchAll: vi.fn() }));

import { searchAll } from "../../model/ipc";
import { createSearchVM } from "../searchVM";

function hit(id: string) {
  return { kind: "task" as const, id, title: id, subtitle: null, state: "active" as const };
}

describe("searchVM", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens empty and closes clean", () => {
    const vm = createSearchVM();
    vm.state.query = "old";
    vm.state.hits = [hit("t1")];

    vm.open();

    expect(vm.state.open).toBe(true);
    expect(vm.state.query).toBe("");
    expect(vm.state.hits).toEqual([]);

    vm.close();
    expect(vm.state.open).toBe(false);
  });

  it("debounces typing into one trimmed search", async () => {
    vi.mocked(searchAll).mockResolvedValue([hit("t1")]);
    const vm = createSearchVM();
    vm.open();

    vm.setQuery("  交底 ");
    vm.setQuery("交底会");
    expect(searchAll).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(200);

    expect(searchAll).toHaveBeenCalledTimes(1);
    expect(searchAll).toHaveBeenCalledWith("交底会");
    expect(vm.state.hits.map((item) => item.id)).toEqual(["t1"]);
  });

  it("clears the hits for a blank query without asking", async () => {
    const vm = createSearchVM();
    vm.open();
    vm.setQuery("交底");
    vm.setQuery("   ");

    await vi.advanceTimersByTimeAsync(300);

    expect(searchAll).not.toHaveBeenCalled();
    expect(vm.state.hits).toEqual([]);
    expect(vm.state.loading).toBe(false);
  });

  it("ignores a reply that arrives after a newer query", async () => {
    let resolveFirst: (value: ReturnType<typeof hit>[]) => void = () => {};
    let resolveSecond: (value: ReturnType<typeof hit>[]) => void = () => {};
    vi.mocked(searchAll)
      .mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)))
      .mockReturnValueOnce(new Promise((resolve) => (resolveSecond = resolve)));
    const vm = createSearchVM();

    vm.state.query = "old";
    const first = vm.run();
    vm.state.query = "new";
    const second = vm.run();

    resolveSecond([hit("new")]);
    await second;
    resolveFirst([hit("old")]);
    await first;

    expect(vm.state.hits.map((item) => item.id)).toEqual(["new"]);
  });

  it("wraps the active row around the result list", async () => {
    vi.mocked(searchAll).mockResolvedValue([hit("t1"), hit("t2")]);
    const vm = createSearchVM();
    vm.state.query = "交底";
    await vm.run();

    expect(vm.state.active).toBe(0);
    vm.move(1);
    expect(vm.state.active).toBe(1);
    vm.move(1);
    expect(vm.state.active).toBe(0);
    vm.move(-1);
    expect(vm.state.active).toBe(1);
  });

  it("keeps the error for the palette to show", async () => {
    vi.mocked(searchAll).mockRejectedValue("db_locked");
    const vm = createSearchVM();
    vm.state.query = "交底";

    await vm.run();

    expect(vm.state.error).toBe("db_locked");
    expect(vm.state.hits).toEqual([]);
    expect(vm.state.loading).toBe(false);
  });
});

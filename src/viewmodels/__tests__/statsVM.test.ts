import { afterEach, describe, expect, it, vi } from "vite-plus/test";

vi.mock("../../model/ipc", () => ({
  statsOverview: vi.fn(),
}));

import { addDays, todayIso } from "../../lib/dates";
import { closeDialog } from "../../lib/dialog";
import { statsOverview } from "../../model/ipc";
import type { StatsOverview } from "../../model/types";
import { createStatsVM } from "../statsVM";

function overview(over: Partial<StatsOverview> = {}): StatsOverview {
  return {
    from: "2026-10-01",
    to: "2026-10-30",
    completed: 0,
    created: 0,
    completedMinutes: 0,
    onTime: 0,
    withDue: 0,
    delayed: 0,
    daily: [],
    byProject: [],
    byCategory: [],
    previousCompleted: 0,
    previousMinutes: 0,
    previousOnTime: 0,
    previousWithDue: 0,
    previousDelayed: 0,
    ...over,
  };
}

describe("statsVM", () => {
  afterEach(() => closeDialog(null));

  it("starts on the last 30 days and loads them", async () => {
    vi.mocked(statsOverview).mockResolvedValue(overview());

    const vm = createStatsVM();
    await vm.refresh();

    const today = todayIso();
    expect(statsOverview).toHaveBeenCalledWith(addDays(today, -29), today);
    expect(vm.state.preset).toBe("30d");
    expect(vm.span.value).toBe(30);
    expect(vm.granularity.value).toBe("day");
  });

  it("moves a preset window to today when the page is reopened", async () => {
    vi.mocked(statsOverview).mockResolvedValue(overview());
    const vm = createStatsVM();
    await vm.refresh();
    // Stand in for an app left open overnight: the window still ends yesterday.
    vm.state.today = addDays(todayIso(), -1);
    vm.state.from = addDays(todayIso(), -30);
    vm.state.to = addDays(todayIso(), -1);

    await vm.refresh();

    const today = todayIso();
    expect(statsOverview).toHaveBeenLastCalledWith(addDays(today, -29), today);
    expect(vm.state.to).toBe(today);
  });

  it("keeps a custom window where the user put it", async () => {
    vi.mocked(statsOverview).mockResolvedValue(overview());
    const vm = createStatsVM();
    await vm.setCustom("2026-10-01", "2026-10-20");

    await vm.refresh();

    expect(statsOverview).toHaveBeenLastCalledWith("2026-10-01", "2026-10-20");
  });

  it("counts quiet days so the trend keeps its scale", async () => {
    vi.mocked(statsOverview).mockResolvedValue(
      overview({ completed: 3, daily: [{ date: "2026-10-05", completed: 3, created: 0 }] }),
    );

    const vm = createStatsVM();
    await vm.refresh();

    expect(vm.buckets.value).toHaveLength(30);
    expect(vm.buckets.value.reduce((sum, bucket) => sum + bucket.completed, 0)).toBe(3);
    expect(vm.hasActivity.value).toBe(true);
  });

  it("has no deltas before the previous window carries anything", async () => {
    vi.mocked(statsOverview).mockResolvedValue(overview({ completed: 4, completedMinutes: 1920 }));

    const vm = createStatsVM();
    await vm.refresh();

    expect(vm.hasPrevious.value).toBe(false);
    expect(vm.completedDelta.value).toBeNull();
    expect(vm.minutesDelta.value).toBeNull();
  });

  it("compares against the previous window once it has data", async () => {
    vi.mocked(statsOverview).mockResolvedValue(
      overview({
        completed: 4,
        completedMinutes: 1920,
        onTime: 3,
        withDue: 4,
        delayed: 1,
        previousCompleted: 6,
        previousMinutes: 2880,
        previousOnTime: 1,
        previousWithDue: 2,
        previousDelayed: 3,
      }),
    );

    const vm = createStatsVM();
    await vm.refresh();

    expect(vm.hasPrevious.value).toBe(true);
    expect(vm.completedDelta.value).toBe(-2);
    expect(vm.minutesDelta.value).toBe(-2);
    expect(vm.rate.value).toBe(75);
    expect(vm.rateDelta.value).toBe(25);
    expect(vm.delayedDelta.value).toBe(-2);
    expect(vm.completedDays.value).toBe("4.0");
    expect(vm.completedHours.value).toBe(32);
  });

  it("switches preset windows", async () => {
    vi.mocked(statsOverview).mockResolvedValue(overview());
    const vm = createStatsVM();

    await vm.setPreset("12w");
    expect(vm.state.preset).toBe("12w");
    expect(vm.span.value).toBe(84);

    await vm.setPreset("year");
    const today = todayIso();
    expect(vm.state.from).toBe(`${today.slice(0, 4)}-01-01`);
    expect(vm.state.to).toBe(today);
  });

  it("swaps an inverted custom range instead of querying it", async () => {
    vi.mocked(statsOverview).mockResolvedValue(overview());
    const vm = createStatsVM();

    await vm.setCustom("2026-10-20", "2026-10-01");

    expect(vm.state.from).toBe("2026-10-01");
    expect(vm.state.to).toBe("2026-10-20");
    expect(statsOverview).toHaveBeenLastCalledWith("2026-10-01", "2026-10-20");
  });

  it("clamps a custom range to a year", async () => {
    vi.mocked(statsOverview).mockResolvedValue(overview());
    const vm = createStatsVM();

    await vm.setCustom("2020-01-01", "2026-10-01");

    expect(vm.span.value).toBe(366);
    expect(vm.state.to).toBe("2026-10-01");
    expect(vm.state.from).toBe(addDays("2026-10-01", -365));
  });

  it("shows no activity for an empty range", async () => {
    vi.mocked(statsOverview).mockResolvedValue(overview());

    const vm = createStatsVM();
    await vm.refresh();

    expect(vm.hasActivity.value).toBe(false);
    expect(vm.rate.value).toBeNull();
    expect(vm.busiest.value).toBeNull();
    expect(vm.projects.value).toEqual([]);
  });
});

/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@solidjs/testing-library";
import { addDays, differenceInCalendarDays, startOfDay, startOfYear } from "date-fns";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../../common/components/__tests__/setup";
import * as api from "../api";
import { StatsView } from "../components/StatsView";
import { dayKey } from "../series";
import type { ProjectProgress, TimeDistribution, TrendPoint } from "../types";

vi.mock("../api", () => ({
  completionTrend: vi.fn(),
  projectProgress: vi.fn(),
  timeDistribution: vi.fn(),
}));

const TODAY = dayKey(new Date());

function trend(): TrendPoint[] {
  return [{ bucket: TODAY, completed: 3 }];
}

function distribution(): TimeDistribution {
  return {
    groups: [
      { id: "p1", name: "Alpha", seconds: 5400 },
      { id: null, name: null, seconds: 600 },
    ],
    buckets: [{ bucket: TODAY, seconds: 6000 }],
  };
}

function progress(): ProjectProgress[] {
  return [{ projectId: "p1", name: "Alpha", total: 4, completed: 3, dueAt: null }];
}

/** Local midnight boundary, the way the view states its queries. */
function midnight(offsetDays = 0): string {
  return addDays(startOfDay(new Date()), offsetDays).toISOString();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.completionTrend).mockResolvedValue(trend());
  vi.mocked(api.projectProgress).mockResolvedValue(progress());
  vi.mocked(api.timeDistribution).mockResolvedValue(distribution());
});

afterEach(cleanup);

describe("StatsView", () => {
  it("queries the last seven local days by default", async () => {
    render(() => <StatsView />);

    await waitFor(() => expect(api.completionTrend).toHaveBeenCalledTimes(1));
    const query = vi.mocked(api.completionTrend).mock.calls[0][0];
    expect(query.granularity).toBe("day");
    expect(query.from).toBe(midnight(-6));
    expect(query.to).toBe(midnight(1));
    expect(query.offsetMinutes).toBe(-new Date().getTimezoneOffset());
    expect(api.timeDistribution).toHaveBeenCalledWith(
      expect.objectContaining({ groupBy: "project" }),
    );
  });

  it("renders the trend total, the heatmap grid and the project comparison", async () => {
    render(() => <StatsView />);

    expect(await screen.findByText("共 3 个完成")).toBeTruthy();
    expect(document.querySelectorAll("[data-day]")).toHaveLength(7);

    // Project comparison: three of four tasks done.
    const projects = await screen.findByRole("region", { name: "项目进度" });
    expect(within(projects).getByText("Alpha")).toBeTruthy();
    expect(within(projects).getByText("75%")).toBeTruthy();
    expect(within(projects).getByText("3/4 个任务")).toBeTruthy();

    // Time distribution per project, inbox time included.
    const distribution = screen.getByRole("region", { name: "时间分布" });
    expect(within(distribution).getByText("共 1 小时 40 分")).toBeTruthy();
    expect(within(distribution).getByText("1 小时 30 分")).toBeTruthy();
    expect(within(distribution).getByText("未归属项目")).toBeTruthy();
  });

  it("switches range and re-queries the matching window", async () => {
    render(() => <StatsView />);
    await waitFor(() => expect(api.completionTrend).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole("button", { name: "近 30 天" }));
    await waitFor(() => expect(api.completionTrend).toHaveBeenCalledTimes(2));
    const month = vi.mocked(api.completionTrend).mock.calls[1][0];
    expect(month.from).toBe(midnight(-29));
    expect(month.granularity).toBe("day");
    await waitFor(() => expect(document.querySelectorAll("[data-day]")).toHaveLength(30));

    // The year is bucketed weekly for the line and daily for the heatmap.
    fireEvent.click(screen.getByRole("button", { name: "本年" }));
    await waitFor(() =>
      expect(
        vi.mocked(api.completionTrend).mock.calls.some((call) => call[0].granularity === "week"),
      ).toBe(true),
    );
    const yearCalls = vi.mocked(api.completionTrend).mock.calls.map((call) => call[0]);
    const weekly = yearCalls.find((query) => query.granularity === "week")!;
    const dayCalls = yearCalls.filter((query) => query.granularity === "day");
    const daily = dayCalls[dayCalls.length - 1];
    expect(weekly.from).toBe(startOfYear(new Date()).toISOString());
    expect(differenceInCalendarDays(new Date(weekly.to), new Date(weekly.from))).toBeGreaterThan(
      30,
    );
    expect(daily.from).toBe(weekly.from);
    await waitFor(() =>
      expect(document.querySelectorAll("[data-day]").length).toBeGreaterThan(30),
    );
  });

  it("splits the time distribution by tag on demand", async () => {
    render(() => <StatsView />);
    await waitFor(() => expect(api.timeDistribution).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByRole("button", { name: "按标签" }));

    await waitFor(() =>
      expect(api.timeDistribution).toHaveBeenLastCalledWith(
        expect.objectContaining({ groupBy: "tag" }),
      ),
    );
  });

  it("surfaces a failed load and retries it", async () => {
    vi.mocked(api.completionTrend).mockRejectedValueOnce({ code: "db", message: "统计读取失败" });

    render(() => <StatsView />);

    expect(await screen.findByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "重试" }));
    expect(await screen.findByText("共 3 个完成")).toBeTruthy();
  });
});

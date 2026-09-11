/**
 * Backend calls for the statistics domain — the only place in this feature
 * that touches the IPC layer. Components read through `hooks.ts`, which owns
 * the range/dimension wiring and stale-response handling.
 */

import { COMMANDS, invokeCommand } from "../../common/ipc";
import type {
  ProjectProgress,
  StatsQuery,
  TimeDistribution,
  TimeDistributionQuery,
  TrendPoint,
} from "./types";

/** Completion curve over the query's `[from, to)` window. */
export function completionTrend(query: StatsQuery): Promise<TrendPoint[]> {
  return invokeCommand(COMMANDS.stats.trend, { query });
}

/** Per-project task tallies; independent of the selected range. */
export function projectProgress(): Promise<ProjectProgress[]> {
  return invokeCommand(COMMANDS.stats.projectProgress);
}

/** Tracked time per project/tag plus its period series. */
export function timeDistribution(query: TimeDistributionQuery): Promise<TimeDistribution> {
  return invokeCommand(COMMANDS.stats.timeDistribution, { query });
}

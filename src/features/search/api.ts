/**
 * Backend calls for the search domain — the only place in this feature that
 * touches the IPC layer. Components never call these directly; they go
 * through `hooks.ts`, which owns debouncing and stale-response handling.
 */

import { COMMANDS, invokeCommand } from "../../common/ipc";
import type { SearchHit } from "./types";

export function querySearch(query: string): Promise<SearchHit[]> {
  return invokeCommand(COMMANDS.search.query, { query });
}

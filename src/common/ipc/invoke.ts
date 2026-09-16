import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
import { recordCommand } from "../perf";
import type { AppCommand } from "./commands";
import { normalizeError } from "./errors";

/**
 * Typed entry point for all backend calls. Feature `api.ts` modules are the
 * only callers; failures are rethrown as a normalized `{ code, message }`.
 */
export async function invokeCommand<T>(
  command: AppCommand,
  args?: InvokeArgs,
): Promise<T> {
  const startedAt = performance.now();
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeError(error);
  } finally {
    // Q-01 性能验收：往返耗时（含失败的那几次）记进 perf 的样本表。
    recordCommand(command, performance.now() - startedAt);
  }
}

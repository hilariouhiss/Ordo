import { invoke, type InvokeArgs } from "@tauri-apps/api/core";
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
  try {
    return await invoke<T>(command, args);
  } catch (error) {
    throw normalizeError(error);
  }
}

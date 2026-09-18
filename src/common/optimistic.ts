/**
 * Domain-agnostic half of the optimistic write flow every feature's hooks
 * follow: `用户动作 → 本地 store 乐观更新 → invoke 落库 → 后端权威结果
 * reconcile → 失败回滚 + 通知`. The store shapes differ per domain; the
 * scaffolding around them does not.
 */

import { normalizeError } from "./ipc";
import { pushError } from "./stores/notifications";

/** Prefix for optimistic ids; never collides with backend UUIDs. */
const TEMP_PREFIX = "optimistic-";
let tempSeq = 0;

/** A throwaway id for an optimistic row, unique across every domain. */
export function nextTempId(): string {
  tempSeq += 1;
  return `${TEMP_PREFIX}${Date.now().toString(36)}-${tempSeq}`;
}

/** Normalizes any thrown value, surfaces it as an error notification. */
export function reportFailure(error: unknown): null {
  const normalized = normalizeError(error);
  pushError(normalized.message, normalized.code);
  return null;
}

/** Applies `apply`, runs `action`, reconciles; rolls back + notifies on failure. */
export async function optimistic<T>(
  apply: () => void,
  rollback: () => void,
  action: () => Promise<T>,
): Promise<T | null> {
  apply();
  try {
    return await action();
  } catch (error) {
    rollback();
    return reportFailure(error);
  }
}

/** Reports "the row you aimed at is gone" (typically a stale view) as an error. */
export function missingEntity(what: string): null {
  pushError(`${what}不存在或数据已刷新，请重试`);
  return null;
}

/**
 * The rollback value for a partial patch: the fields that patch touches, as
 * they are right now.
 *
 * A whole-row snapshot is the obvious version of this, and it is wrong: when a
 * second write lands on the same row while this one is in flight (a rename and
 * a priority change, say), the failed write's rollback would undo the write
 * that succeeded — and the screen would then disagree with the database until
 * the next full load (QA-05).
 */
export function patchRollback<T extends object>(current: T, patch: Partial<T>): Partial<T> {
  const before: Partial<T> = {};
  for (const key of Object.keys(patch) as (keyof T)[]) {
    before[key] = current[key];
  }
  return before;
}
